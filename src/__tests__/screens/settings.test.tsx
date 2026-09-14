import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/(settings)/settings';
import { resetSessionState, SESSION_STORAGE_KEY } from '@/features/session/use-session';

// The screen reads `env.APP_VARIANT` at render time; mutate the mock to pick a variant.
const mockEnv = { APP_VARIANT: 'development' as string | undefined };
// Getters, not a captured value: the factory runs while `mockEnv` is still in its TDZ.
jest.mock('@/lib/env', () => ({
  get env() {
    return mockEnv;
  },
  assertEnv: () => mockEnv,
}));

describe('SettingsScreen', () => {
  beforeEach(async () => {
    resetSessionState();
    await AsyncStorage.clear();
  });

  afterEach(() => {
    mockEnv.APP_VARIANT = 'development';
  });

  it('renders the settings screen container', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
  });

  // The role comes from the `@/tw` Link wrapper, not from a per-screen prop.
  it('exposes the updates link with the link role', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-updates-link')).toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'OTA updates' })).toBeOnTheScreen();
  });

  it('sends a test error to Sentry and confirms it', async () => {
    await render(<SettingsScreen />);
    expect(screen.queryByTestId('settings-sentry-test-sent')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-sentry-test'));
    });
    expect(jest.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'sentry test' }),
      { extra: { source: 'settings-sentry-test' } },
    );
    expect(screen.getByTestId('settings-sentry-test-sent')).toBeOnTheScreen();
  });

  // The guard itself lives in the root layout (src/__tests__/screens/session-guard.test.tsx);
  // here we only check that the control clears the persisted flag.
  it('signs out and clears the persisted session', async () => {
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, 'true');
    await render(<SettingsScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-sign-out'));
    });
    expect(await AsyncStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('hides the Sentry test button in production', async () => {
    mockEnv.APP_VARIANT = 'production';
    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-sentry-test')).toBeNull();
    expect(screen.queryByTestId('settings-sentry-test-sent')).toBeNull();
  });
});
