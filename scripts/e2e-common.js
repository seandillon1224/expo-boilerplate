// Shared bits for the local native-E2E reproduce scripts (`e2e:build`, `e2e:repack`,
// `e2e:ios|android`). They mirror the EAS Workflows native lane (PLAN.md decision 1:
// fingerprint → get-build/build → repack → maestro) step by step so a red workflow can be
// reproduced on a laptop. Everything lives under `e2e/builds/<platform>/` (git-ignored):
//   base.app | base.apk        the EAS build matched by fingerprint (`e2e:build`)
//   base.json                  which build that is (id, fingerprint, profile, app identifier)
//   repacked.app | repacked.apk  base + the current tree's JS bundle (`e2e:repack`)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { ScriptError } = require('./lib/args');
const { which } = require('./lib/device');

const projectRoot = path.join(__dirname, '..');
const buildsRoot = path.join(projectRoot, 'e2e', 'builds');

// eas.json profiles the native lane builds with (release, APP_VARIANT=development, no dev client).
const PROFILES = {
  ios: { profile: 'e2e-ios-sim', ext: 'app', simulator: true },
  android: { profile: 'e2e-android-apk', ext: 'apk', simulator: false },
};

/** The `--platform` entry of an e2e script's option table (scripts/lib/args.js). */
const PLATFORM_OPTION = Object.freeze({ type: 'string', choices: Object.keys(PROFILES) });

/**
 * Reports a clean failure: throws, so `runMain` prints `<name>: <message>` and sets the exit code
 * (see the convention in scripts/lib/args.js — 1 = the thing failed, 2 = fix the command line).
 * Written as an expression (`return fail(…)`, `x ?? fail(…)`) all over the e2e scripts.
 */
function fail(name, message, code = 1) {
  throw new ScriptError(`${name}: ${message}`, code);
}

// Resolves a CLI on PATH (with optional fallbacks) or fails with an install hint.
function requireBinary(name, { fallbacks = [], hint }) {
  const found = which(name, fallbacks);
  if (found) return found;
  throw new ScriptError(
    [
      `\`${name}\` not found on PATH${fallbacks.length ? ` or at ${fallbacks.join(', ')}` : ''}.`,
      hint,
    ]
      .filter(Boolean)
      .join('\n'),
  );
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
  PLATFORM_OPTION,
  PROFILES,
  artifactPaths,
  buildsRoot,
  fail,
  projectRoot,
  readJson,
  relative,
  requireBinary,
  run,
  runJson,
  writeJson,
};
