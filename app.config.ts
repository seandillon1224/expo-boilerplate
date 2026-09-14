import type { ConfigContext, ExpoConfig } from 'expo/config';

import pkg from './package.json';

/**
 * APP_VARIANT drives everything that must differ between installable variants so
 * staging, UAT and production can sit side by side on one device.
 * Set per EAS build profile in eas.json; defaults to development locally.
 */
type Variant = 'development' | 'staging' | 'uat' | 'production';

const VARIANT = (process.env.APP_VARIANT ?? 'development') as Variant;

/**
 * App identity. `bun run init` (scripts/init.js) rewrites this block for a new app; keep the
 * keys one per line so its patterns keep matching. `bundleId` is the iOS bundle identifier,
 * `androidPackage` the Android application id (usually the same, but Android forbids hyphens).
 */
const BASE = {
  name: 'Expo Boilerplate',
  slug: 'expo-boilerplate',
  scheme: 'expoboilerplate',
  bundleId: 'com.seandillon.expoboilerplate',
  androidPackage: 'com.seandillon.expoboilerplate',
} as const;

/**
 * EAS project id (`@seandillon1224/expo-boilerplate`, linked by `eas init`). This is the
 * one place it lives: it feeds `extra.eas.projectId` (EAS Build / Update / Observe) and
 * `updates.url`. `bun run init` rewrites it for a new app; left empty (`bun run init` without
 * `--eas-project-id`), updates and Observe stay off until `eas init` links a project and the
 * id is pasted here.
 */
const EAS_PROJECT_ID: string = '885fa7d0-e079-4722-bafa-e05da702b132';

const SUFFIX: Record<Variant, { name: string; id: string; scheme: string }> = {
  development: { name: ' (Dev)', id: '.dev', scheme: '-dev' },
  staging: { name: ' (Staging)', id: '.staging', scheme: '-staging' },
  uat: { name: ' (UAT)', id: '.uat', scheme: '-uat' },
  production: { name: '', id: '', scheme: '' },
};

const v = SUFFIX[VARIANT];

/**
 * App version = `package.json` `version`, the single source of truth. release-please owns it
 * (the release PR bumps `package.json` + `CHANGELOG.md` and the merge is tagged `v<version>`,
 * see docs/release-ladder.md → Store release); never hand-edit it here or there. Build numbers
 * stay on EAS (`appVersionSource: remote`). `fingerprint.config.js` keeps the bump out of the
 * native fingerprint.
 */
const VERSION: string = pkg.version;

/**
 * EAS Update. `runtimeVersion` follows the native fingerprint (PLAN.md #2), so an OTA
 * only reaches builds whose native code it was made for. Channels are assigned per build
 * profile in eas.json and created server-side by T3.3; a build with no channel (dev
 * clients, `e2e-*`) never receives an update and runs the embedded bundle.
 * `checkAutomatically` stays ON_LOAD (expo-updates' native launch check); the `useUpdatePolicy`
 * driver (src/features/updates, ADR-0003) owns runtime behaviour on top of it.
 */
const UPDATES_URL = EAS_PROJECT_ID ? `https://u.expo.dev/${EAS_PROJECT_ID}` : undefined;

/**
 * Per-update "critical" flag (ADR-0003, D3 update policies). `EAS_UPDATE_CRITICAL=1` at publish
 * time writes `extra.updatePolicy: 'forced'` into this config, which `eas update` embeds in the
 * update manifest (`extra.expoClient.extra.updatePolicy`). The running app reads that field from
 * the *incoming* update on a successful check (`useUpdatePolicy`) and downloads + reloads at once,
 * whatever the build-level `EXPO_PUBLIC_UPDATE_POLICY` says. It is set per publish by the
 * workflows' `critical` input (#137) — never as an EAS environment variable, or every update
 * would be critical. Republish / promote carries the manifest unchanged, so the flag survives
 * promotion. Not `EXPO_PUBLIC_`: it must not be baked into the JS bundle.
 */
const UPDATE_CRITICAL = ['1', 'true'].includes(
  (process.env.EAS_UPDATE_CRITICAL ?? '').trim().toLowerCase(),
);

/**
 * Sentry org/project are build-time values (never EXPO_PUBLIC_*). They are only
 * needed for native source-map upload on EAS Build, so they are omitted when unset:
 * `expo config` and CNG prebuild keep working, and sentry-cli falls back to the
 * SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN environment variables.
 */
const SENTRY_PLUGIN_PROPS = {
  url: 'https://sentry.io/',
  ...(process.env.SENTRY_ORG ? { organization: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `${BASE.name}${v.name}`,
  slug: BASE.slug,
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: `${BASE.scheme}${v.scheme}`,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: `${BASE.bundleId}${v.id}`,
    icon: './assets/expo.icon',
    supportsTablet: false,
    infoPlist: {
      // We ship no encryption beyond Apple's exempt HTTPS, so declare it up front. Without this
      // key every TestFlight build stops at "Missing Compliance" waiting for a human to answer
      // the export-compliance question, which would block the unattended `testflight` job in
      // .eas/workflows/release.yml. Flip it to true (and file the ERN/exemption) only if the app
      // ever adds non-exempt cryptography.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: `${BASE.androidPackage}${v.id}`,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  runtimeVersion: { policy: 'fingerprint' },
  updates: {
    enabled: Boolean(UPDATES_URL),
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    ...(UPDATES_URL ? { url: UPDATES_URL } : {}),
  },
  plugins: [
    'expo-router',
    // Enables per-app language settings (iOS Settings / Android 13+ app languages).
    'expo-localization',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    ['@sentry/react-native/expo', SENTRY_PLUGIN_PROPS],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: VARIANT,
    // Read natively by EAS Build / Update and EAS Observe (src/lib/observe.ts); absent until
    // `eas init` links a project (see EAS_PROJECT_ID above).
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    // Only present on critical publishes; see UPDATE_CRITICAL above.
    ...(UPDATE_CRITICAL ? { updatePolicy: 'forced' } : {}),
  },
});
