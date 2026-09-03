// https://docs.expo.dev/guides/customizing-metro/
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/**
 * Sentry wraps Expo's default config (Debug ID serializer so uploaded source maps
 * match bundles, collapsed Sentry frames in LogBox). NativeWind is layered on top so
 * its transformer and CSS handling see the final config.
 * @type {import('expo/metro-config').MetroConfig}
 */
const config = getSentryExpoConfig(__dirname, {
  getDefaultConfig,
  // Web session replay is not used; keep it out of the web bundle.
  includeWebReplay: false,
});

module.exports = withNativewind(config, {
  // Keep CSS variables as runtime references so light/dark tokens in global.css
  // resolve reactively on native (inlining also breaks PlatformColor in variables).
  inlineVariables: false,
  // className is wired explicitly through the wrappers in src/tw instead of
  // patching every react-native primitive.
  globalClassNamePolyfill: false,
});
