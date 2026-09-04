// `bun run e2e:build` — local twin of the workflow's `get-build` (+ conditional `build`) job.
// Fingerprints the current tree, asks EAS for a finished build of the E2E profile with that
// exact hash, and downloads it to `e2e/builds/<platform>/base.(app|apk)`. Never starts a
// (paid) `eas build` unless `--build` is passed; without it, prints the command and exits 2.
const fs = require('fs');
const path = require('path');
const { createFingerprintAsync } = require('@expo/fingerprint');

const {
  PROFILES,
  artifactPaths,
  fail,
  parseArgs,
  projectRoot,
  relative,
  run,
  runJson,
  writeJson,
} = require('./e2e-common');

const NAME = 'e2e:build';
const USAGE = `Usage: bun run e2e:build [--platform ios|android] [--build] [--build-id <id>]

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

Next: bun run e2e:repack, then bun run e2e:ios | e2e:android.`;

const { platform, flags, values } = parseArgs(process.argv, { name: NAME, usage: USAGE });
const { profile, ext, simulator } = PROFILES[platform];
const easBin = path.join(projectRoot, 'node_modules', '.bin', 'eas');
const paths = artifactPaths(platform);

function easJson(args) {
  return runJson(NAME, easBin, [...args, '--json', '--non-interactive']);
}

function findBuild(fingerprint) {
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

function download(build, fingerprint) {
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

(async () => {
  if (run(easBin, ['whoami', '--non-interactive']).status !== 0) {
    fail(NAME, 'not logged in to EAS. Run `bun run eas login` (or set EXPO_TOKEN) and try again.');
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
    download(build, buildFingerprint ?? fingerprint);
    return;
  }

  let build = findBuild(fingerprint);
  if (!build) {
    const command = `bun run eas build --platform ${platform} --profile ${profile} --non-interactive`;
    if (!flags.has('build')) {
      console.error(
        [
          `${NAME}: no finished ${profile} build with fingerprint ${fingerprint}.`,
          'The workflow would start a fresh native build here (paid). To do the same locally:',
          `  ${command}`,
          'then re-run `bun run e2e:build`, or pass `--build` to let this script run it.',
        ].join('\n'),
      );
      process.exit(2);
    }
    console.log(`No matching build; running \`${command}\` (this is a paid EAS build) …`);
    const result = run(easBin, [...command.split(' ').slice(3), '--wait'], { stdio: 'inherit' });
    if (result.status !== 0) fail(NAME, 'eas build failed; see output above.');
    build = findBuild(fingerprint);
    if (!build)
      fail(NAME, 'the build finished but EAS lists no finished build with this fingerprint.');
  }
  download(build, fingerprint);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
