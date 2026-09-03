// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = withNativewind(config, {
  // Keep CSS variables as runtime references so light/dark tokens in global.css
  // resolve reactively on native (inlining also breaks PlatformColor in variables).
  inlineVariables: false,
  // className is wired explicitly through the wrappers in src/tw instead of
  // patching every react-native primitive.
  globalClassNamePolyfill: false,
});
