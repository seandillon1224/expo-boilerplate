// `bun run e2e:repack` — local twin of the workflow's `repack` job. Uses `@expo/repack-app`
// (the same package the job runs) to bundle the current tree's JS (`expo export:embed`, Hermes)
// and inject it into the fingerprint-matched base build from `e2e:build`, producing
// `e2e/builds/<platform>/repacked.(app|apk)` without a native rebuild.
//
// Signing: the iOS artifact is a simulator `.app`, which needs no code signature, so repack strips
// the old one and nothing is signed. Android is re-signed with the package's bundled debug
// keystore (`pass:android`), like the CLI default — fine for emulators; store builds never come
// through here. Android also needs a JDK (repack bundles apktool.jar) and the SDK build-tools
// (`aapt2`, `zipalign`, `apksigner`) under `$ANDROID_SDK_ROOT` (falls back to `$ANDROID_HOME`).
const fs = require('fs');
const path = require('path');

const {
  PROFILES,
  artifactPaths,
  fail,
  parseArgs,
  projectRoot,
  readJson,
  relative,
  requireBinary,
  run,
  writeJson,
} = require('./e2e-common');

const NAME = 'e2e:repack';
const USAGE = `Usage: bun run e2e:repack [--platform ios|android] [--verbose]

Mirrors the native lane's repack job: exports the current tree's JS bundle and injects it into
e2e/builds/<platform>/base.(app|apk) (from \`bun run e2e:build\`), writing
e2e/builds/<platform>/repacked.(app|apk). No native rebuild, no signing identity needed.

Prerequisites:
  ios      nothing beyond Xcode command line tools (simulator .app, unsigned)
  android  a JDK on PATH (\`java\`) and Android build-tools under $ANDROID_SDK_ROOT or $ANDROID_HOME

Options:
  --platform ios|android   default ios
  --verbose                pass through to @expo/repack-app
  --help                   this text`;

const { platform, flags } = parseArgs(process.argv, { name: NAME, usage: USAGE });
const { ext } = PROFILES[platform];
const paths = artifactPaths(platform);

if (!fs.existsSync(paths.base)) {
  fail(
    NAME,
    `${relative(paths.base)} not found. Run \`bun run e2e:build --platform ${platform}\` first.`,
  );
}

if (platform === 'android') {
  requireBinary('java', {
    hint: 'A JDK is required: repack-app decodes/rebuilds the APK with apktool. `brew install --cask temurin`.',
  });
  const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdkRoot || !fs.existsSync(path.join(sdkRoot, 'build-tools'))) {
    fail(
      NAME,
      'Android build-tools not found. Set ANDROID_SDK_ROOT (or ANDROID_HOME) to an SDK with build-tools/ (aapt2, zipalign, apksigner).',
    );
  }
  process.env.ANDROID_SDK_ROOT = sdkRoot;
}

// The base build was made with APP_VARIANT=development (eas.json e2e-* profiles); the embedded
// config/bundle must be derived the same way or the bundle id / scheme would not match.
process.env.APP_VARIANT = process.env.APP_VARIANT || 'development';

(async () => {
  const { ConsoleLogger, repackAppAndroidAsync, repackAppIosAsync } = require('@expo/repack-app');
  const base = readJson(paths.baseMeta);
  fs.rmSync(paths.repacked, { recursive: true, force: true });
  fs.rmSync(paths.work, { recursive: true, force: true });
  console.log(`Repacking ${relative(paths.base)} → ${relative(paths.repacked)} …`);

  const common = {
    platform,
    projectRoot,
    sourceAppPath: paths.base,
    outputPath: paths.repacked,
    workingDirectory: paths.work,
    verbose: flags.has('verbose'),
    logger: new ConsoleLogger(),
  };
  const output =
    platform === 'ios'
      ? await repackAppIosAsync(common)
      : await repackAppAndroidAsync({
          ...common,
          // Same as the repack-app CLI default: bundled debug.keystore, password `android`.
          androidSigningOptions: { keyStorePassword: 'pass:android' },
        });

  const head = run('git', ['rev-parse', 'HEAD']);
  writeJson(paths.repackedMeta, {
    platform,
    baseBuildId: base?.buildId ?? null,
    baseFingerprint: base?.fingerprint ?? null,
    gitCommitHash: head.status === 0 ? head.stdout.trim() : null,
    repackedAt: new Date().toISOString(),
  });
  console.log(`Wrote ${relative(output)} (repacked.${ext}). Next: bun run e2e:${platform}.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
