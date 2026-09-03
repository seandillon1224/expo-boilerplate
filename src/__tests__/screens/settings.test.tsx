import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/(settings)/settings';

describe('SettingsScreen', () => {
  it('renders the settings screen container', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
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
});
