// Global test setup. @testing-library/react-native ships its own matchers since v12.4;
// they are registered automatically when the package is imported.
import '@testing-library/react-native';
// Screens call useTranslation() and expect the catalog to be registered.
import '@/i18n';

// `bun run perf` (Reassure) runs Jest with this same setup and marks its child process with
// REASSURE_OUTPUT_FILE; only then load the perf configuration so unit runs never import reassure.
if (process.env.REASSURE_OUTPUT_FILE) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./reassure.setup');
}

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

// Rozenite plugins are ESM dev-only packages that expect a DevTools connection;
// the layout hook is inert under Jest.
jest.mock('@/lib/devtools', () => ({ useDevTools: jest.fn() }));

// Sentry needs native modules; the app only ever calls this small surface.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  setTag: jest.fn(),
  setContext: jest.fn(),
  flush: jest.fn(async () => true),
  wrap: <T>(component: T) => component,
}));

// expo-observe needs a native module. Root HOC is identity, `configure` is inert, and
// `useObserve` hands every screen the same `markInteractive` spy so tests can assert on it.
jest.mock('expo-observe', () => {
  const markInteractive = jest.fn();
  return {
    Observe: {
      configure: jest.fn(),
      markInteractive,
      logEvent: jest.fn(),
      reportError: jest.fn(),
      dispatchEvents: jest.fn(async () => {}),
    },
    ObserveRoot: { wrap: <T>(component: T) => component },
    ObserveInteractiveMarker: () => null,
    ObserveErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
    useObserve: () => ({ markInteractive }),
  };
});

// expo-updates needs a native module. Default to the "updates disabled" shape a dev
// client reports; tests that exercise the enabled path override `isEnabled` per test.
jest.mock('expo-updates', () => ({
  isEnabled: false,
  runtimeVersion: 'test',
  channel: null,
  updateId: null,
  isEmbeddedLaunch: true,
  createdAt: null,
  checkAutomatically: null,
  checkForUpdateAsync: jest.fn(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: jest.fn(() => Promise.resolve({ isNew: false })),
  reloadAsync: jest.fn(() => Promise.resolve()),
  useUpdates: jest.fn(() => ({
    currentlyRunning: { isEmbeddedLaunch: true, isEmergencyLaunch: false },
    isStartupProcedureRunning: false,
    isUpdateAvailable: false,
    isUpdatePending: false,
    isChecking: false,
    isDownloading: false,
  })),
}));
