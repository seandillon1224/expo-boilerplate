// `bun run e2e:ios` / `e2e:android` — local twin of the workflow's `maestro` job. Boots a
// simulator / emulator, installs the repacked build (falls back to the base build), and runs the
// Maestro workspace's flows tagged for the platform (`.maestro/flows/*`, native entries) with the
// same JUnit output layout as `e2e:web` (`maestro-<platform>/`, plus Maestro's debug output under
// `debug/` and, after a failure, device logs under `device/` — docs/native-e2e.md → Failure
// artifacts). Shuts the device down again only if this script booted it.
//
// MAESTRO_APP_ID is the variant's bundle id / package derived in app.config.ts for APP_VARIANT=development
// (what the e2e-* build profiles use); `.maestro/config.yaml` documents the env contract.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectDeviceLogs } = require('./e2e-device-logs');
const {
  PROFILES,
  artifactPaths,
  fail,
  parseArgs,
  projectRoot,
  relative,
  requireBinary,
  run,
  runJson,
} = require('./e2e-common');

const NAME = 'e2e:run';
const USAGE = `Usage: bun run e2e:ios | bun run e2e:android   (node scripts/e2e-run.js --platform <p>)

Mirrors the native lane's maestro job: boots a device, installs
e2e/builds/<platform>/repacked.(app|apk) (or base.(app|apk) if you skipped e2e:repack) and runs
  maestro test .maestro --include-tags <platform> -e MAESTRO_APP_ID=<bundle id | package>
with JUnit output in maestro-<platform>/ (report.xml, Maestro debug output in debug/, and on a
failure the simulator log / logcat in device/ — the same set the workflow's maestro job uploads).

Device selection:
  ios      an already-booted iPhone simulator, else the newest available iPhone (xcrun simctl)
  android  an online adb device/emulator, else the first AVD from \`emulator -list-avds\`

Options:
  --platform ios|android   default ios
  --device <udid|serial>   use this simulator UDID / adb serial instead of auto-selecting
  --keep                   leave the simulator / emulator running afterwards
  --help                   this text`;

const { platform, flags, values } = parseArgs(process.argv, { name: NAME, usage: USAGE });
const { ext } = PROFILES[platform];
const paths = artifactPaths(platform);
const flowsDir = path.join(projectRoot, '.maestro', 'flows');
const outputDir = path.join(projectRoot, `maestro-${platform}`);

const artifact = [paths.repacked, paths.base].find((candidate) => fs.existsSync(candidate));
if (!artifact) {
  fail(
    NAME,
    [
      `no ${platform} build under ${relative(paths.dir)}/ (expected repacked.${ext} or base.${ext}).`,
      `Run \`bun run e2e:build --platform ${platform}\` then \`bun run e2e:repack --platform ${platform}\`.`,
    ].join('\n'),
  );
}

// spawnSync-based cleanup runs fine from the exit hook because nothing here is async.
function onExit(cleanup) {
  process.on('exit', cleanup);
}

// Native entries live flat in .maestro/flows (web ones in flows/web, see .maestro/config.yaml);
// list the ones tagged for this platform so the notice below can name them.
function flowsTagged(tag) {
  if (!fs.existsSync(flowsDir)) return [];
  return fs.readdirSync(flowsDir).filter((file) => {
    if (!/\.ya?ml$/.test(file)) return false;
    const header = fs.readFileSync(path.join(flowsDir, file), 'utf8').split(/^---$/m)[0];
    const tags = header.match(/^tags:\s*\[([^\]]*)\]/m);
    return tags ? tags[1].split(',').some((t) => t.trim() === tag) : false;
  });
}

function appId() {
  const expoBin = path.join(projectRoot, 'node_modules', '.bin', 'expo');
  const config = runJson(NAME, expoBin, ['config', '--type', 'public', '--json'], {
    env: { ...process.env, APP_VARIANT: 'development', CI: '1' },
  });
  const id = platform === 'ios' ? config.ios?.bundleIdentifier : config.android?.package;
  if (!id)
    fail(
      NAME,
      `expo config has no ${platform === 'ios' ? 'ios.bundleIdentifier' : 'android.package'}.`,
    );
  return id;
}

function maestroBinary() {
  return requireBinary('maestro', {
    fallbacks: [path.join(os.homedir(), '.maestro', 'bin', 'maestro')],
    hint: 'Install: curl -Ls "https://get.maestro.mobile.dev" | bash   (CI pins 2.10.0)',
  });
}

// --- iOS -------------------------------------------------------------------------------------

function pickSimulator(xcrun) {
  const { devices } = runJson(NAME, xcrun, ['simctl', 'list', '-j', 'devices', 'available']);
  const iphones = Object.entries(devices).flatMap(([runtime, list]) =>
    list
      .filter((d) => d.isAvailable && /^iPhone/.test(d.name))
      .map((d) => ({
        ...d,
        runtime,
        version: runtime
          .match(/iOS-(\d+)-(\d+)/)
          ?.slice(1)
          .map(Number) ?? [0, 0],
      })),
  );
  if (values.device) {
    const chosen = iphones.find((d) => d.udid === values.device || d.name === values.device);
    return (
      chosen ??
      fail(NAME, `simulator \`${values.device}\` is not an available iPhone (xcrun simctl list).`)
    );
  }
  const booted = iphones.find((d) => d.state === 'Booted');
  if (booted) return booted;
  // Newest runtime, then the highest model number within it (iPhone 17 Pro > iPhone 17 > 16 …).
  const model = (d) =>
    Number(d.name.match(/iPhone (\d+)/)?.[1] ?? 0) + (/Pro/.test(d.name) ? 0.5 : 0);
  iphones.sort(
    (a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || model(b) - model(a),
  );
  return (
    iphones[0] ??
    fail(NAME, 'no iPhone simulator available. Install one in Xcode → Settings → Components.')
  );
}

function runIos(maestro, id) {
  const xcrun = requireBinary('xcrun', { hint: 'Install Xcode and its command line tools.' });
  const sim = pickSimulator(xcrun);
  const bootedByUs = sim.state !== 'Booted';
  console.log(
    `Simulator: ${sim.name} (${sim.runtime.replace(/.*\./, '')}, ${sim.udid})${bootedByUs ? ' — booting' : ''}`,
  );
  if (bootedByUs) {
    const boot = run(xcrun, ['simctl', 'boot', sim.udid], { stdio: 'inherit' });
    if (boot.status !== 0) fail(NAME, 'simctl boot failed.');
    // Only shut down what we booted, and on every exit path (install failure included).
    if (!flags.has('keep')) onExit(() => run(xcrun, ['simctl', 'shutdown', sim.udid]));
    run(xcrun, ['simctl', 'bootstatus', sim.udid, '-b'], { stdio: 'inherit' });
  }
  const install = run(xcrun, ['simctl', 'install', sim.udid, artifact], { stdio: 'inherit' });
  if (install.status !== 0) fail(NAME, `simctl install ${relative(artifact)} failed.`);
  return maestroTest(maestro, id, sim.udid);
}

// --- Android ---------------------------------------------------------------------------------

function onlineAdbDevices(adb) {
  const list = run(adb, ['devices']);
  return list.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
}

function waitForBoot(adb, serial) {
  run(adb, ['-s', serial, 'wait-for-device']);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const probe = run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']);
    if (probe.stdout.trim() === '1') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  fail(NAME, `emulator ${serial} did not finish booting within 3 minutes.`);
}

function runAndroid(maestro, id) {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '';
  const adb = requireBinary('adb', {
    fallbacks: [path.join(sdk, 'platform-tools', 'adb')],
    hint: 'Install Android platform-tools (Android Studio → SDK Manager) or set ANDROID_HOME.',
  });
  let serial = values.device ?? onlineAdbDevices(adb)[0];
  if (!serial) {
    const emulator = requireBinary('emulator', {
      fallbacks: [path.join(sdk, 'emulator', 'emulator')],
      hint: 'No device online and no `emulator` binary: start an emulator/device and re-run, or install the Android Emulator.',
    });
    const avd = run(emulator, ['-list-avds']).stdout.trim().split('\n').filter(Boolean)[0];
    if (!avd)
      fail(
        NAME,
        'no device online and no AVDs defined. Create one in Android Studio → Device Manager.',
      );
    console.log(`Emulator: starting AVD ${avd} …`);
    const child = require('child_process').spawn(
      emulator,
      ['-avd', avd, '-no-snapshot-save', '-no-boot-anim'],
      {
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();
    if (!flags.has('keep')) onExit(() => serial && run(adb, ['-s', serial, 'emu', 'kill']));
    const deadline = Date.now() + 60_000;
    while (!serial && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
      serial = onlineAdbDevices(adb).find((s) => s.startsWith('emulator-'));
    }
    if (!serial) fail(NAME, `emulator ${avd} did not show up in adb within 60 s.`);
  }
  waitForBoot(adb, serial);
  console.log(`Device: ${serial}`);
  const install = run(adb, ['-s', serial, 'install', '-r', artifact], { stdio: 'inherit' });
  if (install.status !== 0) fail(NAME, `adb install ${relative(artifact)} failed.`);
  // Start logcat from a clean buffer so device/logcat.txt only covers this run.
  run(adb, ['-s', serial, 'logcat', '-c']);
  return maestroTest(maestro, id, serial);
}

// --- Maestro ---------------------------------------------------------------------------------

function maestroTest(maestro, id, device) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  const args = [
    '--device',
    device,
    'test',
    '.maestro',
    '--include-tags',
    platform,
    '-e',
    `MAESTRO_APP_ID=${id}`,
    '--format',
    'junit',
    '--output',
    `maestro-${platform}/report.xml`,
    '--test-output-dir',
    `maestro-${platform}`,
    '--debug-output',
    `maestro-${platform}/debug`,
    '--flatten-debug-output',
  ];
  console.log(`$ maestro ${args.join(' ')}`);
  const startedAt = new Date();
  const status = run(maestro, args, { stdio: 'inherit' }).status ?? 1;
  if (status !== 0) {
    // Same collector the workflow's after_maestro_tests hook runs (scripts/e2e-device-logs.js).
    const deviceDir = path.join(outputDir, 'device');
    collectDeviceLogs({ platform, device, outDir: deviceDir, since: startedAt });
    console.error(
      `${NAME}: maestro exited ${status}. Recording/screenshots + maestro.log: ${relative(outputDir)}/debug/, ` +
        `device logs: ${relative(deviceDir)}/ (docs/native-e2e.md → Failure artifacts).`,
    );
  }
  return status;
}

const flows = flowsTagged(platform);
if (flows.length === 0) {
  console.log(
    `${NAME}: no flow in .maestro/flows is tagged \`${platform}\`, so there is nothing to run. ` +
      `Build ${relative(artifact)} is ready; exiting 0.`,
  );
  process.exit(0);
}
console.log(
  `Installing ${relative(artifact)}; ${flows.length} flow(s) tagged ${platform}: ${flows.join(', ')}`,
);
const maestro = maestroBinary();
const id = appId();
console.log(`MAESTRO_APP_ID=${id}`);
process.exit(platform === 'ios' ? runIos(maestro, id) : runAndroid(maestro, id));
