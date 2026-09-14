import { renderHook } from '@testing-library/react-native';
import * as Updates from 'expo-updates';

import { useUpdateInfo } from '@/features/updates/use-update-info';

/**
 * The `expo-updates` mock in `jest.setup.ts` reports the "dev client" shape (updates off,
 * every constant null). These tests flip the constants to prove the hook passes each one
 * through and applies the documented fallback when it is missing.
 */
type MutableUpdates = {
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;
  isEmbeddedLaunch: boolean | null;
  isEnabled: boolean | null;
  createdAt: Date | null;
  checkAutomatically: Updates.UpdatesCheckAutomaticallyValue | null;
};
const mockUpdates = Updates as unknown as MutableUpdates;

const useUpdatesMock = jest.mocked(Updates.useUpdates);
const idleState = {
  currentlyRunning: { isEmbeddedLaunch: true, isEmergencyLaunch: false },
  isStartupProcedureRunning: false,
  isUpdateAvailable: false,
  isUpdatePending: false,
  isChecking: false,
  isDownloading: false,
} as unknown as Updates.UseUpdatesReturnType;

describe('useUpdateInfo', () => {
  const original = { ...mockUpdates };

  afterEach(() => {
    Object.assign(mockUpdates, original);
    useUpdatesMock.mockReturnValue(idleState);
  });

  it('reports the dev-client defaults when the constants are null', async () => {
    const { result } = await renderHook(() => useUpdateInfo());

    expect(result.current).toMatchObject({
      runtimeVersion: 'test',
      channel: null,
      updateId: null,
      isEmbeddedLaunch: true,
      isEnabled: false,
      createdAt: null,
      checkAutomatically: null,
      isChecking: false,
      isDownloading: false,
      isUpdatePending: false,
    });
  });

  it('passes the expo-updates constants through when an OTA update is running', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    Object.assign(mockUpdates, {
      runtimeVersion: 'fingerprint-abc',
      channel: 'production',
      updateId: 'update-1',
      isEmbeddedLaunch: false,
      isEnabled: true,
      createdAt,
      checkAutomatically: 'ON_LOAD' as Updates.UpdatesCheckAutomaticallyValue,
    });

    const { result } = await renderHook(() => useUpdateInfo());

    expect(result.current).toMatchObject({
      runtimeVersion: 'fingerprint-abc',
      channel: 'production',
      updateId: 'update-1',
      isEmbeddedLaunch: false,
      isEnabled: true,
      createdAt,
      checkAutomatically: 'ON_LOAD',
    });
  });

  it('falls back to embedded / disabled when the constants are undefined', async () => {
    Object.assign(mockUpdates, {
      runtimeVersion: undefined,
      isEmbeddedLaunch: undefined,
      isEnabled: undefined,
      createdAt: undefined,
    });

    const { result } = await renderHook(() => useUpdateInfo());

    expect(result.current.runtimeVersion).toBeNull();
    expect(result.current.createdAt).toBeNull();
    // A build that cannot tell us is treated as the safe case: embedded, updates off.
    expect(result.current.isEmbeddedLaunch).toBe(true);
    expect(result.current.isEnabled).toBe(false);
  });

  it('surfaces the live useUpdates() state', async () => {
    const checkError = new Error('check failed');
    const downloadError = new Error('download failed');
    const availableUpdate = { updateId: 'update-2' };
    useUpdatesMock.mockReturnValue({
      ...idleState,
      isChecking: true,
      isDownloading: true,
      isUpdatePending: true,
      availableUpdate,
      checkError,
      downloadError,
    } as unknown as Updates.UseUpdatesReturnType);

    const { result } = await renderHook(() => useUpdateInfo());

    expect(result.current).toMatchObject({
      isChecking: true,
      isDownloading: true,
      isUpdatePending: true,
      availableUpdate,
      checkError,
      downloadError,
    });
  });
});
