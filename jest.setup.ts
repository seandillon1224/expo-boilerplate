// Global test setup. @testing-library/react-native ships its own matchers since v12.4;
// they are registered automatically when the package is imported.
import '@testing-library/react-native';

// AsyncStorage has no native module under Jest; use the in-memory mock it ships.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
