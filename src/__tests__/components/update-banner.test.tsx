import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

import { UpdateBanner } from '@/features/updates/update-banner';
import {
  resetUpdatePolicyState,
  useUpdatePolicyDriver,
} from '@/features/updates/use-update-policy';
import { env } from '@/lib/env';

jest.mock('@/lib/env', () => ({
  env: { API_URL: 'https://example.com', UPDATE_POLICY: 'opt-in' },
  assertEnv: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react-native-safe-area-context/jest/mock').default,
);

const mockUpdates = Updates as unknown as { isEnabled: boolean };
const mockEnv = env as { UPDATE_POLICY: string };
const devGlobal = globalThis as unknown as { __DEV__: boolean };

/** The root layout's composition: driver once, banner next to the navigator. */
function Root() {
  useUpdatePolicyDriver();
  return <UpdateBanner />;
}

async function mountWithReadyUpdate() {
  jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce({
    isAvailable: true,
    isRollBackToEmbedded: false,
    manifest: { id: 'u1' },
  } as unknown as Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>);
  jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce({
    isNew: true,
  } as Awaited<ReturnType<typeof Updates.fetchUpdateAsync>>);
  await render(<Root />);
  await act(async () => {});
}

describe('UpdateBanner', () => {
  const originalDev = devGlobal.__DEV__;

  beforeEach(() => {
    devGlobal.__DEV__ = false;
    mockUpdates.isEnabled = true;
    mockEnv.UPDATE_POLICY = 'opt-in';
  });

  afterEach(async () => {
    // Unmount first: resetting the store while the banner is still mounted notifies its
    // `useSyncExternalStore` subscriber outside `act(...)`.
    await cleanup();
    resetUpdatePolicyState();
    devGlobal.__DEV__ = originalDev;
    mockUpdates.isEnabled = false;
    jest.clearAllMocks();
  });

  it('renders nothing while no update is ready', async () => {
    await render(<Root />);
    await act(async () => {});
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });

  it('shows the banner once an update is downloaded under opt-in', async () => {
    await mountWithReadyUpdate();
    expect(screen.getByTestId('update-banner')).toBeOnTheScreen();
    expect(screen.getByText('Update ready')).toBeOnTheScreen();
    expect(screen.getByTestId('update-banner-restart')).toBeOnTheScreen();
    expect(screen.getByTestId('update-banner-later')).toBeOnTheScreen();
  });

  it('restarts into the update from the banner', async () => {
    await mountWithReadyUpdate();
    await act(async () => {
      fireEvent.press(screen.getByTestId('update-banner-restart'));
    });
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('hides on "Later" without reloading', async () => {
    await mountWithReadyUpdate();
    await act(async () => {
      fireEvent.press(screen.getByTestId('update-banner-later'));
    });
    expect(screen.queryByTestId('update-banner')).toBeNull();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('never renders under the silent policy, even with an update downloaded', async () => {
    mockEnv.UPDATE_POLICY = 'silent';
    await mountWithReadyUpdate();
    expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});
