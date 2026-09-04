// Device logs for a failed native E2E run — the one failure artifact Maestro itself does not
// produce. Used twice, so the two stay identical (docs/native-e2e.md → Failure artifacts):
//   - `bun run e2e:ios | e2e:android` (scripts/e2e-run.js) call `collectDeviceLogs()` after a
//     non-zero Maestro exit and write into `maestro-<platform>/device/`;
//   - the workflow's `maestro_<platform>` jobs run this file as a CLI from an
//     `after_maestro_tests` hook and upload the directory as the "Device logs (<platform>)"
//     artifact (.eas/workflows/e2e.yml).
// Node built-ins only: the maestro job checks the project out but never installs node_modules.
//
//   ios      xcrun simctl spawn <udid> log show   → device.log   (unified log, app processes only:
//            everything under /Containers/Bundle/Application/, i.e. the app under test on a fresh
//            device) plus any crash report Xcode wrote since the run started → crashes/*.ips
//   android  adb logcat -d                         → logcat.txt   (main + system + crash buffers)
//
// Usage: node scripts/e2e-device-logs.js --platform ios|android [--device <udid|serial>]
//                                        [--out <dir>] [--since <ISO date>]
// Defaults: --device = the booted simulator / adb's only device, --out = maestro-<platform>/device,
// --since = the last 30 minutes. Never exits non-zero for a missing device or tool: a log-collection
// hiccup must not turn a red run into a different red, and `run` steps in the hook rely on that.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'e2e:device-logs';

function which(binary, fallbacks = []) {
  const found = spawnSync('which', [binary], { encoding: 'utf8' });
  if (found.status === 0) return found.stdout.trim();
  return fallbacks.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function capture(command, args, file) {
  // A hard timeout: `adb` blocks forever with no device attached, and a hung collector would
  // hold the job (and the local script's exit) hostage.
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) return `${command}: ${result.error.message}`;
  fs.writeFileSync(file, result.stdout);
  if (result.status !== 0)
    return `${command} ${args.slice(0, 3).join(' ')} exited ${result.status}: ${(result.stderr || '').trim()}`;
  return null;
}

// `log show --start` wants local wall-clock time, "YYYY-MM-DD HH:MM:SS".
function localTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function collectIos({ device, outDir, since, warnings }) {
  const xcrun = which('xcrun');
  if (!xcrun) return warnings.push('xcrun not found; no simulator log collected.');
  const window = since ? ['--start', localTimestamp(since)] : ['--last', '30m'];
  const error = capture(
    xcrun,
    [
      'simctl',
      'spawn',
      device ?? 'booted',
      'log',
      'show',
      '--style',
      'compact',
      ...window,
      '--predicate',
      'processImagePath CONTAINS "/Containers/Bundle/Application/"',
    ],
    path.join(outDir, 'device.log'),
  );
  if (error) warnings.push(error);
  // Simulator app crashes land in the host's DiagnosticReports as .ips files.
  const reports = path.join(os.homedir(), 'Library', 'Logs', 'DiagnosticReports');
  const cutoff = since ? since.getTime() : Date.now() - 30 * 60_000;
  if (!fs.existsSync(reports)) return undefined;
  for (const file of fs.readdirSync(reports)) {
    const full = path.join(reports, file);
    if (/\.ips$/.test(file) && fs.statSync(full).mtimeMs >= cutoff) {
      fs.mkdirSync(path.join(outDir, 'crashes'), { recursive: true });
      fs.copyFileSync(full, path.join(outDir, 'crashes', file));
    }
  }
  return undefined;
}

function collectAndroid({ device, outDir, warnings }) {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '';
  const adb = which('adb', [path.join(sdk, 'platform-tools', 'adb')]);
  if (!adb) return warnings.push('adb not found; no logcat collected.');
  const online = spawnSync(adb, ['devices'], { encoding: 'utf8', timeout: 30_000 })
    .stdout?.split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
  if (!online?.length || (device && !online.includes(device)))
    return warnings.push(`adb device ${device ?? '(any)'} is not online; no logcat collected.`);
  const target = device ? ['-s', device] : [];
  const error = capture(
    adb,
    [...target, 'logcat', '-d', '-v', 'threadtime'],
    path.join(outDir, 'logcat.txt'),
  );
  if (error) warnings.push(error);
  return undefined;
}

// Returns the list of warnings (empty when everything was captured). Always writes `outDir`
// with at least README.txt, so an artifact upload of the directory never fails on a missing path.
function collectDeviceLogs({ platform, device, outDir, since }) {
  fs.mkdirSync(outDir, { recursive: true });
  const warnings = [];
  (platform === 'ios' ? collectIos : collectAndroid)({ device, outDir, since, warnings });
  fs.writeFileSync(
    path.join(outDir, 'README.txt'),
    [
      `Device logs captured by scripts/e2e-device-logs.js (${platform}) at ${new Date().toISOString()}.`,
      since ? `Window: since ${since.toISOString()}.` : 'Window: the last 30 minutes.',
      ...(warnings.length ? ['', 'Warnings:', ...warnings.map((w) => `- ${w}`)] : []),
      '',
      'Triage guide: docs/native-e2e.md → Failure artifacts.',
      '',
    ].join('\n'),
  );
  for (const warning of warnings) console.warn(`${NAME}: ${warning}`);
  return warnings;
}

module.exports = { collectDeviceLogs };

if (require.main === module) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const platform = value('--platform');
  if (!['ios', 'android'].includes(platform)) {
    console.error(`${NAME}: --platform must be ios or android.`);
    process.exit(1);
  }
  const sinceArg = value('--since');
  const since = sinceArg ? new Date(sinceArg) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`${NAME}: --since must be an ISO date (got \`${sinceArg}\`).`);
    process.exit(1);
  }
  const outDir = path.resolve(value('--out') ?? `maestro-${platform}/device`);
  collectDeviceLogs({ platform, device: value('--device'), outDir, since });
  console.log(`${NAME}: wrote ${outDir}`);
}
