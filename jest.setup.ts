// Global test setup. @testing-library/react-native ships its own matchers since v12.4;
// they are registered automatically when the package is imported.
import '@testing-library/react-native';
// Screens call useTranslation() and expect the catalog to be registered.
import '@/i18n';

// AsyncStorage has no native module under Jest; use the in-memory mock it ships.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-localization needs a native module; report a device locale that has no bundled
// catalog so tests exercise the `en` fallback path.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'fr', languageTag: 'fr-FR', regionCode: 'FR' }],
}));
