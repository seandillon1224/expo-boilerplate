// Pin an Android emulator / device to one locale before Maestro runs (T13.7).
//
// Why: `.maestro/subflows/select-tab.yaml` taps the Android tab bar by its visible label
// (`TAB_LABEL`), because `NativeTabs` renders a native BottomNavigationView whose React `testID`
// never reaches the accessibility tree — there is no id to select. A label selector is only
// deterministic if the device's language is, and a device's language is not ours to assume: the
// app bundles `en` today, but the moment a second catalog lands in `src/i18n/locales/` a
// French-locale emulator renders "Réglages" and the tab tap fails on a perfectly healthy app.
// Pinning the locale removes the variable instead of chasing it, and makes every other
// locale-sensitive surface (dates, numbers, system permission dialogs) deterministic too.
//
// Used twice, so the two stay identical (docs/native-e2e.md → Device locale):
//   - `bun run e2e:android` (scripts/e2e-run.js) calls `pinAndroidLocale()` after the device is
//     up and before the APK is installed;
//   - the workflow's `maestro_android` job runs this file as a CLI from its
//     `before_maestro_tests` hook (.eas/workflows/e2e.yml).
//
// `persist.sys.locale` is read by the framework at start, so changing it means restarting the
// framework (`adb shell stop && start`, ~20 s). That only happens when the device is not already
// on the target locale, which on a stock emulator image is never — the common path is one
// `getprop` and no restart. iOS needs none of this: the iOS branch of `select-tab.yaml` selects
// by accessibility identifier, which does not move with the language.
//
// Node built-ins only (./lib/args and ./lib/device are too): the maestro job checks the project
// out but never installs node_modules. Never exits non-zero — a locale that could not be pinned
// is a warning, not a different red than the one the flows are about to give you.
//
// Usage: node scripts/e2e-pin-locale.js [--device <serial>] [--locale en-US]
const { spawnSync } = require('node:child_process');

const { parseArgs, runMain } = require('./lib/args');
const { adbBin, adbOnline } = require('./lib/device');

const NAME = 'e2e:pin-locale';

/** The locale every native E2E run assumes. Matches the `en` catalog `TAB_LABEL` is written from. */
const DEFAULT_LOCALE = 'en-US';

const CLI = {
  name: NAME,
  usage: `Usage: node scripts/e2e-pin-locale.js [options]

Pins an Android emulator / device to one locale so the tab-bar label selector in
.maestro/subflows/select-tab.yaml is deterministic. No-op when it is already there.

Options:
  --device <serial>   default: adb's only online device
  --locale <tag>      default ${DEFAULT_LOCALE}
  --help              this text`,
  options: {
    device: { type: 'string' },
    locale: { type: 'string' },
  },
};

/** Time-boxed `adb …`; adb blocks forever when its server cannot start. */
function adb(bin, serial, args, timeout = 60_000) {
  return spawnSync(bin, [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
    timeout,
  });
}

function getprop(bin, serial, prop) {
  const result = adb(bin, serial, ['shell', 'getprop', prop], 30_000);
  return result.status === 0 ? result.stdout.trim() : '';
}

/** `en-US` and `en_US` and a bare `en` all mean the same thing here. */
function sameLanguage(current, target) {
  const language = (tag) => tag.replace('_', '-').split('-')[0].toLowerCase();
  return Boolean(current) && language(current) === language(target);
}

/** Blocks until the framework reports a completed boot, or the deadline passes. */
function waitForFramework(bin, serial, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (getprop(bin, serial, 'sys.boot_completed') === '1') return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  return false;
}

/**
 * Pins `serial` (or adb's only online device) to `locale`. Returns the list of warnings — empty
 * when the device is on the locale, whether or not this had to change it. Never throws.
 */
function pinAndroidLocale({ device, locale = DEFAULT_LOCALE } = {}) {
  const warnings = [];
  const bin = adbBin();
  if (!bin) {
    warnings.push('adb not found; locale left as the device had it.');
    return warn(warnings);
  }
  const online = adbOnline(bin);
  const serial = device ?? (online.length === 1 ? online[0] : undefined);
  if (!online.length || (device && !online.includes(device))) {
    warnings.push(`adb device ${device ?? '(any)'} is not online; locale not pinned.`);
    return warn(warnings);
  }
  if (!serial) {
    warnings.push(`${online.length} adb devices online; pass --device <serial> to pin one.`);
    return warn(warnings);
  }

  // `persist.sys.locale` is the user's choice and wins; `ro.product.locale` is the image default
  // and is what a device that has never been touched reports.
  const current =
    getprop(bin, serial, 'persist.sys.locale') || getprop(bin, serial, 'ro.product.locale');
  if (sameLanguage(current, locale)) {
    console.log(`${NAME}: ${serial} is already ${current || locale}; nothing to do.`);
    return warnings;
  }

  console.log(`${NAME}: ${serial} is ${current || '(unknown)'}; pinning to ${locale}.`);
  const set = adb(bin, serial, ['shell', 'setprop', 'persist.sys.locale', locale], 30_000);
  if (set.status !== 0) {
    warnings.push(
      `setprop persist.sys.locale ${locale} exited ${set.status}: ${(set.stderr || '').trim()}. ` +
        'A production-signed device does not allow it — use an emulator for the E2E lane.',
    );
    return warn(warnings);
  }
  // The framework only reads the property at start, so the value alone changes nothing.
  console.log(`${NAME}: restarting the framework so ${locale} takes effect (~20 s) …`);
  adb(bin, serial, ['shell', 'stop'], 60_000);
  adb(bin, serial, ['shell', 'start'], 60_000);
  if (!waitForFramework(bin, serial)) {
    warnings.push(`${serial} did not finish restarting within 3 minutes after the locale change.`);
    return warn(warnings);
  }
  const applied = getprop(bin, serial, 'persist.sys.locale');
  if (!sameLanguage(applied, locale)) {
    warnings.push(
      `${serial} still reports \`${applied || '(unset)'}\` after the restart; the tab-bar label ` +
        'selector may not match (docs/native-e2e.md → Device locale).',
    );
    return warn(warnings);
  }
  console.log(`${NAME}: ${serial} is now ${applied}.`);
  return warnings;
}

function warn(warnings) {
  for (const warning of warnings) console.warn(`${NAME}: ${warning}`);
  return warnings;
}

function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;
  pinAndroidLocale({ device: values.device, locale: values.locale ?? DEFAULT_LOCALE });
  return 0;
}

module.exports = { DEFAULT_LOCALE, pinAndroidLocale, sameLanguage };

if (require.main === module) runMain(main);
