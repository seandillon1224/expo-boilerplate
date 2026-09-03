import { renderHook } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

import { useUpdatePolicy } from '@/features/updates/use-update-policy';

const mockUpdates = Updates as unknown as { isEnabled: boolean };
// `__DEV__` is a Metro global; the tests flip it to exercise both guards.
const devGlobal = globalThis as unknown as { __DEV__: boolean };

describe('useUpdatePolicy', () => {
  const originalDev = devGlobal.__DEV__;

  afterEach(() => {
    devGlobal.__DEV__ = originalDev;
    mockUpdates.isEnabled = false;
    jest.clearAllMocks();
  });

  it('is the manual policy stub', async () => {
    const { result } = await renderHook(() => useUpdatePolicy());
    expect(result.current.policy).toBe('manual');
  });

  it('skips in dev builds before touching expo-updates', async () => {
    devGlobal.__DEV__ = true;
    mockUpdates.isEnabled = true;
    const { result } = await renderHook(() => useUpdatePolicy());
    await expect(result.current.checkForUpdate()).resolves.toEqual({ skipped: 'dev' });
    await expect(result.current.downloadAndReload()).resolves.toEqual({ skipped: 'dev' });
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('skips when updates are disabled', async () => {
    devGlobal.__DEV__ = false;
    const { result } = await renderHook(() => useUpdatePolicy());
    await expect(result.current.checkForUpdate()).resolves.toEqual({ skipped: 'disabled' });
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('downloads and reloads only when the fetched update is new', async () => {
    devGlobal.__DEV__ = false;
    mockUpdates.isEnabled = true;
    const { result } = await renderHook(() => useUpdatePolicy());

    await expect(result.current.downloadAndReload()).resolves.toEqual({
      isNew: false,
      reloaded: false,
    });
    expect(Updates.reloadAsync).not.toHaveBeenCalled();

    jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce({
      isNew: true,
    } as Awaited<ReturnType<typeof Updates.fetchUpdateAsync>>);
    await expect(result.current.downloadAndReload()).resolves.toEqual({
      isNew: true,
      reloaded: true,
    });
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
  });
});
