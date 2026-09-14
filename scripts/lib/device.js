'use strict';
/**
 * Devices and device tooling for every script that talks to a simulator / emulator (T11.2).
 *
 * Why one file: `which()` was written three times, `adb devices` was parsed three times (twice
 * with a timeout, once without), `~/.maestro/bin/maestro` was hard-coded four times, the app id
 * was derived twice and `ANDROID_SDK_ROOT || ANDROID_HOME` five times — `doctor.js` reading the
 * two in the opposite order, so a box with only `ANDROID_SDK_ROOT` got a different answer from
 * the doctor than from the e2e scripts. `flashlight.js` also imported three of these helpers from
 * `a11y-audit.js`, which made an audit script a dependency of a perf script.
 *
 * Callers: `e2e-run.js`, `e2e-device-logs.js`, `a11y-audit.js`, `flashlight.js`, `doctor.js`.
 *
 * ## Skip vs fail
 *
 * `pickDevice` and `appId` return `{ device } | { id }` or `{ skip: reason }` instead of throwing:
 * the same preflight is a hard failure locally (`bun run e2e:a11y`) and a notice in the EAS
 * `after_maestro_tests` hooks (`--no-fail`), so the decision belongs to the caller, not here.
 * Neither boots a device nor installs an app — that is `e2e-run.js`'s job.
 *
 * Node built-ins and `./bin` only — no package, not even `./args`: these scripts run as EAS
 * workflow hooks from a checkout with no `node_modules`, and
 * `scripts/__tests__/builtins-only.test.ts` walks the require graph to enforce it.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { binPath, projectRoot } = require('./bin');

/** The one install line for Maestro; CI and `.eas/workflows/e2e.yml` pin the version. */
const MAESTRO_HINT = 'Install: curl -Ls "https://get.maestro.mobile.dev" | bash   (CI pins 2.10.0)';

/** Resolves a binary on PATH, else the first fallback path that exists, else null. */
function which(binary, fallbacks = []) {
  const found = spawnSync('which', [binary], { encoding: 'utf8' });
  if (found.status === 0) return found.stdout.trim();
  return fallbacks.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/**
 * The Android SDK location. `ANDROID_SDK_ROOT` wins over the older `ANDROID_HOME` (Google's own
 * precedence); `''` when neither is set, which callers treat as "no fallback paths".
 */
function sdkRoot(env = process.env) {
  return env.ANDROID_SDK_ROOT || env.ANDROID_HOME || '';
}

/** Where the Maestro installer puts the CLI when it is not on PATH. */
function maestroFallback(home = os.homedir()) {
  return path.join(home, '.maestro', 'bin', 'maestro');
}

/** `maestro` on PATH, else the installer's own location, else null. */
function maestroBin(home) {
  return which('maestro', [maestroFallback(home)]);
}

/** SDK-relative fallbacks for a platform-tools / emulator binary (empty without an SDK root). */
function sdkFallbacks(binary, env = process.env) {
  const sdk = sdkRoot(env);
  if (!sdk) return [];
  const dir = binary === 'emulator' ? 'emulator' : 'platform-tools';
  return [path.join(sdk, dir, binary)];
}

/** `adb` on PATH, else `$ANDROID_SDK_ROOT/platform-tools/adb`, else null. */
function adbBin(env = process.env) {
  return which('adb', sdkFallbacks('adb', env));
}

/** Serials of the `device`-state entries in `adb devices` output (offline / unauthorized dropped). */
function parseAdbDevices(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .slice(1) // "List of devices attached"
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
}

/**
 * Online adb serials. Always time-boxed: `adb devices` blocks forever when the server cannot
 * start, and a hung probe would hold an EAS hook (and its job) hostage.
 */
function adbOnline(adb, { timeout = 30_000 } = {}) {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8', timeout });
  return parseAdbDevices(result.stdout ?? '');
}

/** iOS half of `pickDevice`: an already-booted simulator only. */
function pickSimulator(requested) {
  const xcrun = which('xcrun');
  if (!xcrun) return { skip: 'xcrun not found (install Xcode).' };
  const list = spawnSync(xcrun, ['simctl', 'list', '-j', 'devices', 'booted'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60_000,
  });
  let booted = [];
  try {
    booted = Object.values(JSON.parse(list.stdout).devices).flat();
  } catch {
    return { skip: 'could not read `xcrun simctl list -j devices booted`.' };
  }
  if (requested) {
    const found = booted.find((d) => d.udid === requested || d.name === requested);
    return found ? { device: found.udid } : { skip: `simulator \`${requested}\` is not booted.` };
  }
  return booted[0]
    ? { device: booted[0].udid }
    : { skip: 'no booted simulator. Run `bun run e2e:ios --keep` first (installs the e2e build).' };
}

/**
 * The device to drive: `{ device: udid|serial }` or `{ skip: reason }`. Never boots anything —
 * every caller audits or profiles a device someone else left running (`e2e:<p> --keep`).
 */
function pickDevice(platform, requested) {
  if (platform === 'ios') return pickSimulator(requested);
  const adb = adbBin();
  if (!adb)
    return { skip: 'adb not found (install Android platform-tools or set ANDROID_SDK_ROOT).' };
  const online = adbOnline(adb);
  if (requested)
    return online.includes(requested)
      ? { device: requested }
      : { skip: `adb device \`${requested}\` is not online.` };
  if (online.length === 1) return { device: online[0] };
  if (online.length === 0)
    return {
      skip: 'no adb device online. Run `bun run e2e:android --keep` first (installs the e2e build).',
    };
  return { skip: `${online.length} adb devices online; pick one with --device <serial>.` };
}

/**
 * The bundle id / package of the e2e build: `{ id }` or `{ skip: reason }`.
 *
 * Derived from `app.config.ts` with `APP_VARIANT=development` (what the `e2e-*` eas.json profiles
 * build), the same way `bun run e2e:ios` does. The EAS hooks have no `node_modules`, so they set
 * `MAESTRO_APP_ID` on the job and this falls back to it.
 */
function appId(platform, env = process.env) {
  const expoBin = binPath('expo');
  if (fs.existsSync(expoBin)) {
    const args = ['config', '--type', 'public', '--json'];
    const result = spawnSync(expoBin, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...env, APP_VARIANT: 'development', CI: '1' },
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status === 0) {
      try {
        const config = JSON.parse(result.stdout);
        const id = platform === 'ios' ? config.ios?.bundleIdentifier : config.android?.package;
        if (id) return { id };
      } catch {
        // Fall through to MAESTRO_APP_ID: a broken `expo config` is still a skip, not a crash.
      }
    }
  }
  if (env.MAESTRO_APP_ID) return { id: env.MAESTRO_APP_ID };
  return {
    skip: `could not derive the ${platform} app id: run \`bun install\` (it comes from app.config.ts with APP_VARIANT=development) or set MAESTRO_APP_ID.`,
  };
}

/** A path for humans: repo-relative when it is inside the repo, absolute when `--out` is not. */
function display(target, root = projectRoot) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') ? rel : target;
}

module.exports = {
  MAESTRO_HINT,
  adbBin,
  adbOnline,
  appId,
  display,
  maestroBin,
  maestroFallback,
  parseAdbDevices,
  pickDevice,
  projectRoot,
  sdkFallbacks,
  sdkRoot,
  which,
};
