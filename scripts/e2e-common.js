// Shared bits for the local native-E2E reproduce scripts (`e2e:build`, `e2e:repack`,
// `e2e:ios|android`). They mirror the EAS Workflows native lane (PLAN.md decision 1:
// fingerprint → get-build/build → repack → maestro) step by step so a red workflow can be
// reproduced on a laptop. Everything lives under `e2e/builds/<platform>/` (git-ignored):
//   base.app | base.apk        the EAS build matched by fingerprint (`e2e:build`)
//   base.json                  which build that is (id, fingerprint, profile, app identifier)
//   repacked.app | repacked.apk  base + the current tree's JS bundle (`e2e:repack`)
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const buildsRoot = path.join(projectRoot, 'e2e', 'builds');

// eas.json profiles the native lane builds with (release, APP_VARIANT=development, no dev client).
const PROFILES = {
  ios: { profile: 'e2e-ios-sim', ext: 'app', simulator: true },
  android: { profile: 'e2e-android-apk', ext: 'apk', simulator: false },
};

function parseArgs(argv, { name, usage }) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    process.exit(0);
  }
  const flags = new Set();
  const values = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) fail(name, `unexpected argument \`${arg}\`. Try --help.`);
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      values[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }
  const platform = values.platform ?? 'ios';
  if (!PROFILES[platform]) fail(name, `--platform must be ios or android (got \`${platform}\`).`);
  return { platform, flags, values };
}

function fail(name, message, code = 1) {
  console.error(`${name}: ${message}`);
  process.exit(code);
}

// Resolves a CLI on PATH (with optional fallbacks) or exits with an install hint.
function requireBinary(name, { fallbacks = [], hint }) {
  const which = spawnSync('which', [name], { encoding: 'utf8' });
  if (which.status === 0) return which.stdout.trim();
  const found = fallbacks.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  console.error(
    `\`${name}\` not found on PATH${fallbacks.length ? ` or at ${fallbacks.join(', ')}` : ''}.`,
  );
  if (hint) console.error(hint);
  return process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', ...options });
}

function runJson(name, command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    fail(
      name,
      `\`${path.basename(command)} ${args.join(' ')}\` failed:\n${result.stderr || result.stdout}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fail(
      name,
      `could not parse JSON from \`${path.basename(command)} ${args.join(' ')}\`:\n${result.stdout}`,
    );
  }
}

function artifactPaths(platform) {
  const dir = path.join(buildsRoot, platform);
  const { ext } = PROFILES[platform];
  return {
    dir,
    base: path.join(dir, `base.${ext}`),
    baseMeta: path.join(dir, 'base.json'),
    repacked: path.join(dir, `repacked.${ext}`),
    repackedMeta: path.join(dir, 'repacked.json'),
    work: path.join(dir, '.repack-work'),
  };
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function relative(file) {
  return path.relative(projectRoot, file);
}

module.exports = {
  PROFILES,
  artifactPaths,
  buildsRoot,
  fail,
  parseArgs,
  projectRoot,
  readJson,
  relative,
  requireBinary,
  run,
  runJson,
  writeJson,
};
