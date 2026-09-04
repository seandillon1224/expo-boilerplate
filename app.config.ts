import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT drives everything that must differ between installable variants so
 * staging, UAT and production can sit side by side on one device.
 * Set per EAS build profile in eas.json; defaults to development locally.
 */
type Variant = 'development' | 'staging' | 'uat' | 'production';

const VARIANT = (process.env.APP_VARIANT ?? 'development') as Variant;

const BASE = {
  name: 'Expo Boilerplate',
  slug: 'expo-boilerplate',
  scheme: 'expoboilerplate',
  bundleId: 'com.seandillon.expoboilerplate',
} as const;

/**
 * EAS project id (`@seandillon1224/expo-boilerplate`, linked by `eas init`). This is the
 * one place it lives: it feeds `extra.eas.projectId` (EAS Build / Update / Observe) and
 * `updates.url`. `bun run init` (T7.1) rewrites it for a new app.
 */
const EAS_PROJECT_ID = '885fa7d0-e079-4722-bafa-e05da702b132';

const SUFFIX: Record<Variant, { name: string; id: string; scheme: string }> = {
  development: { name: ' (Dev)', id: '.dev', scheme: '-dev' },
  staging: { name: ' (Staging)', id: '.staging', scheme: '-staging' },
  uat: { name: ' (UAT)', id: '.uat', scheme: '-uat' },
  production: { name: '', id: '', scheme: '' },
};

const v = SUFFIX[VARIANT];

/**
 * EAS Update. `runtimeVersion` follows the native fingerprint (PLAN.md #2), so an OTA
 * only reaches builds whose native code it was made for. Channels are assigned per build
 * profile in eas.json and created server-side by T3.3; a build with no channel (dev
 * clients, `e2e-*`) never receives an update and runs the embedded bundle.
 * `checkAutomatically` stays ON_LOAD for now — the `useUpdatePolicy` hook
 * (src/features/updates, filled in by D3) owns runtime behaviour.
 */
const UPDATES_URL = `https://u.expo.dev/${EAS_PROJECT_ID}`;

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
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: `${BASE.scheme}${v.scheme}`,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: `${BASE.bundleId}${v.id}`,
    icon: './assets/expo.icon',
    supportsTablet: false,
  },
  android: {
    package: `${BASE.bundleId}${v.id}`,
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
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    url: UPDATES_URL,
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
    // Read natively by EAS Build / Update and EAS Observe (src/lib/observe.ts).
    eas: { projectId: EAS_PROJECT_ID },
  },
});
