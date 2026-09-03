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

const SUFFIX: Record<Variant, { name: string; id: string; scheme: string }> = {
  development: { name: ' (Dev)', id: '.dev', scheme: '-dev' },
  staging: { name: ' (Staging)', id: '.staging', scheme: '-staging' },
  uat: { name: ' (UAT)', id: '.uat', scheme: '-uat' },
  production: { name: '', id: '', scheme: '' },
};

const v = SUFFIX[VARIANT];

/**
 * EAS Update. `runtimeVersion` follows the native fingerprint (PLAN.md #2), so an OTA
 * only reaches builds whose native code it was made for. `url` / `extra.eas.projectId`
 * are added by `eas init` (#28) and channels by T3.3; until then updates are configured
 * but inert, and the app runs the embedded bundle (`Updates.isEnabled` is false in dev
 * clients regardless). `checkAutomatically` stays ON_LOAD for now — the
 * `useUpdatePolicy` hook (src/features/updates, filled in by D3) owns runtime behaviour.
 */
const UPDATES_URL = process.env.EAS_UPDATE_URL;

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
  },
});
