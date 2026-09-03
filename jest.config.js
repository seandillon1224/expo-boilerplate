/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    // CSS is handled by Metro (web) or NativeWind; tests only need it to resolve.
    '\\.(css)$': '<rootDir>/jest/style-mock.js',
  },
  // `*.perf-test.tsx` under src/__perf__/ is deliberately not matched here: Reassure runs those
  // with its own --testMatch on top of this config (`bun run perf`). Do not add them to
  // testPathIgnorePatterns, or Reassure would skip them too.
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}', '**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.expo/',
    '/dist/',
    '/dist-',
    '/ios/',
    '/android/',
    '/.maestro/',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/app/**/_layout.tsx',
    '!src/**/*.d.ts',
    '!src/**/__tests__/**',
    '!src/__perf__/**',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  reporters: process.env.CI
    ? ['default', ['jest-junit', { outputDirectory: 'junit', outputName: 'jest.xml' }]]
    : ['default'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|standard-navigation|@sentry/react-native|native-base|react-native-svg)',
  ],
};
