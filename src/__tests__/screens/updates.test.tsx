import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

import UpdatesScreen from '@/app/(tabs)/(settings)/updates';

const mockUpdates = Updates as unknown as { isEnabled: boolean };
// `__DEV__` is a Metro global; the tests flip it to exercise both guards.
const devGlobal = globalThis as unknown as { __DEV__: boolean };

async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe('UpdatesScreen', () => {
  const originalDev = devGlobal.__DEV__;

  afterEach(() => {
    devGlobal.__DEV__ = originalDev;
    mockUpdates.isEnabled = false;
    jest.mocked(Updates.checkForUpdateAsync).mockClear();
  });

  it('renders every row from the expo-updates constants', async () => {
    await render(<UpdatesScreen />);
    expect(screen.getByTestId('updates-screen')).toBeOnTheScreen();
    const row = (id: string) => within(screen.getByTestId(`updates-row-${id}`));
    expect(row('runtimeVersion').getByText('test')).toBeOnTheScreen();
    expect(row('channel').getByText('—')).toBeOnTheScreen();
    expect(row('updateId').getByText('—')).toBeOnTheScreen();
    expect(row('source').getByText(/^Embedded/)).toBeOnTheScreen();
    expect(row('createdAt').getByText('—')).toBeOnTheScreen();
    expect(row('enabled').getByText('No')).toBeOnTheScreen();
    expect(row('policy').getByText('Manual')).toBeOnTheScreen();
    expect(screen.queryByTestId('updates-apply')).toBeNull();
  });

  it('reports a skipped check when updates are disabled', async () => {
    devGlobal.__DEV__ = false;
    await render(<UpdatesScreen />);
    await press('updates-check');
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('updates-status')).toHaveTextContent(/disabled/i);
  });

  it('reports a skipped check in dev builds', async () => {
    devGlobal.__DEV__ = true;
    mockUpdates.isEnabled = true;
    await render(<UpdatesScreen />);
    await press('updates-check');
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('updates-status')).toHaveTextContent(/development/i);
  });

  it('checks for an update when enabled and offers to apply it', async () => {
    devGlobal.__DEV__ = false;
    mockUpdates.isEnabled = true;
    jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce({
      isAvailable: true,
    } as Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>);

    await render(<UpdatesScreen />);
    await press('updates-check');

    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('updates-status')).toHaveTextContent(/available/i);
    expect(screen.getByTestId('updates-apply')).toBeOnTheScreen();

    await press('updates-apply');
    expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows up-to-date when no update is available', async () => {
    devGlobal.__DEV__ = false;
    mockUpdates.isEnabled = true;
    await render(<UpdatesScreen />);
    await press('updates-check');
    expect(screen.getByTestId('updates-status')).toHaveTextContent(/up to date/i);
    expect(screen.queryByTestId('updates-apply')).toBeNull();
  });
});
