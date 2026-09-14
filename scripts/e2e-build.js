// `bun run e2e:build` — local twin of the workflow's `get-build` (+ conditional `build`) job.
// Fingerprints the current tree, asks EAS for a finished build of the E2E profile with that
// exact hash, and downloads it to `e2e/builds/<platform>/base.(app|apk)`. Never starts a
// (paid) `eas build` unless `--build` is passed; without it, prints the command and exits 2
// (the usage / "change the command line" code — scripts/lib/args.js).
const fs = require('fs');
const path = require('path');
const { createFingerprintAsync } = require('@expo/fingerprint');

const { parseArgs, runMain } = require('./lib/args');
const {
  PLATFORM_OPTION,
  PROFILES,
  artifactPaths,
  fail,
  projectRoot,
  relative,
  run,
  runJson,
  writeJson,
} = require('./e2e-common');

const NAME = 'e2e:build';
const CLI = {
  name: NAME,
  usage: `Usage: bun run e2e:build [--platform ios|android] [--build] [--build-id <id>]

Mirrors the native lane's get-build / build jobs for laptop debugging:
  1. fingerprint the current tree (same hash as \`bun run fingerprint --platform <p>\`)
  2. find a finished EAS build of the E2E profile (eas.json: e2e-ios-sim | e2e-android-apk)
     with that fingerprint — the workflow's \`get-build\` match
  3. download it to e2e/builds/<platform>/base.(app|apk) and record it in base.json

Options:
  --platform ios|android   default ios
  --build                  no match: run \`eas build\` (paid, waits for it) then download.
                           Without this flag a miss prints the command and exits 2.
  --build-id <id>          skip fingerprint matching and download this build instead
  --help                   this text

Next: bun run e2e:repack, then bun run e2e:ios | e2e:android.`,
  options: {
    platform: { ...PLATFORM_OPTION, default: 'ios' },
    build: { type: 'boolean' },
    'build-id': { type: 'string' },
  },
};

const easBin = path.join(projectRoot, 'node_modules', '.bin', 'eas');

function easJson(args) {
  return runJson(NAME, easBin, [...args, '--json', '--non-interactive']);
}

function findBuild(platform, fingerprint) {
  const { profile, simulator } = PROFILES[platform];
  const args = [
    'build:list',
    '--platform',
    platform,
    '--build-profile',
    profile,
    '--status',
    'finished',
    '--fingerprint-hash',
    fingerprint,
    '--limit',
    '1',
  ];
  if (simulator) args.push('--simulator');
  const builds = easJson(args);
  return Array.isArray(builds) && builds.length > 0 ? builds[0] : null;
}

function download(platform, build, fingerprint) {
  const { profile, ext } = PROFILES[platform];
  const paths = artifactPaths(platform);
  console.log(`Downloading build ${build.id} (${build.buildProfile}, ${build.createdAt}) …`);
  // eas-cli keeps an extracted copy in its own cache; we copy it under e2e/builds so the repack
  // and run scripts have one stable, project-local location.
  const { path: cached } = easJson(['build:download', '--build-id', build.id]);
  if (!cached || !fs.existsSync(cached)) {
    fail(NAME, `eas build:download reported no artifact for build ${build.id}.`);
  }
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.rmSync(paths.base, { recursive: true, force: true });
  fs.cpSync(cached, paths.base, { recursive: true });
  writeJson(paths.baseMeta, {
    platform,
    profile,
    buildId: build.id,
    fingerprint,
    appIdentifier: build.appIdentifier ?? null,
    gitCommitHash: build.gitCommitHash ?? null,
    createdAt: build.createdAt,
    downloadedAt: new Date().toISOString(),
  });
  console.log(
    `Saved ${relative(paths.base)} (base.${ext}); details in ${relative(paths.baseMeta)}.`,
  );
}

async function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;
  const { platform } = values;
  const { profile } = PROFILES[platform];

  if (run(easBin, ['whoami', '--non-interactive']).status !== 0) {
    fail(
      NAME,
      'not logged in to EAS. Run `bun run eas login` (or set EXPO_TOKEN) and try again.',
      2,
    );
  }

  const { hash: fingerprint } = await createFingerprintAsync(projectRoot, {
    platforms: [platform],
  });
  console.log(`${platform} fingerprint: ${fingerprint}`);

  if (values['build-id']) {
    // `build:view --json` takes no --non-interactive flag; call it directly.
    const build = runJson(NAME, easBin, ['build:view', values['build-id'], '--json']);
    if (!build?.id) fail(NAME, `build ${values['build-id']} not found.`);
    const buildFingerprint = build.fingerprint?.hash ?? build.metrics?.fingerprintHash ?? null;
    if (buildFingerprint && buildFingerprint !== fingerprint) {
      console.warn(
        `warning: build fingerprint ${buildFingerprint} differs from the tree's (${fingerprint}).`,
      );
    }
    download(platform, build, buildFingerprint ?? fingerprint);
    return 0;
  }

  let build = findBuild(platform, fingerprint);
  if (!build) {
    // One argv, printed and spawned — never a string re-split into arguments.
    const buildArgs = ['build', '--platform', platform, '--profile', profile, '--non-interactive'];
    const command = `bun run eas ${buildArgs.join(' ')}`;
    if (!values.build) {
      console.error(
        [
          `${NAME}: no finished ${profile} build with fingerprint ${fingerprint}.`,
          'The workflow would start a fresh native build here (paid). To do the same locally:',
          `  ${command}`,
          'then re-run `bun run e2e:build`, or pass `--build` to let this script run it.',
        ].join('\n'),
      );
      return 2;
    }
    console.log(`No matching build; running \`${command}\` (this is a paid EAS build) …`);
    const result = run(easBin, [...buildArgs, '--wait'], { stdio: 'inherit' });
    if (result.status !== 0) fail(NAME, 'eas build failed; see output above.');
    build = findBuild(platform, fingerprint);
    if (!build)
      fail(NAME, 'the build finished but EAS lists no finished build with this fingerprint.');
  }
  download(platform, build, fingerprint);
  return 0;
}

runMain(main);
