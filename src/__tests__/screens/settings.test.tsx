import { render, screen } from '@testing-library/react-native';

import SettingsScreen from '@/app/(tabs)/(settings)/settings';

describe('SettingsScreen', () => {
  it('renders the settings screen container', async () => {
    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
  });
});
