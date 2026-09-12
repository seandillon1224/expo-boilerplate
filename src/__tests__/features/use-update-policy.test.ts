import { act, renderHook } from '@testing-library/react-native';
import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus } from 'react-native';

import {
  resetUpdatePolicyState,
  RESUME_RELOAD_AFTER_MS,
  useUpdatePolicy,
  useUpdatePolicyDriver,
} from '@/features/updates/use-update-policy';
import { env } from '@/lib/env';
import { captureException } from '@/lib/sentry';

// The policy is read from `@/lib/env` at call time, so tests can flip it per case.
jest.mock('@/lib/env', () => ({
  env: { API_URL: 'https://example.com', UPDATE_POLICY: 'silent' },
  assertEnv: jest.fn(),
}));
jest.mock('@/lib/sentry', () => ({
  flushSentry: jest.fn(async () => {}),
  captureException: jest.fn(),
}));

const mockUpdates = Updates as unknown as { isEnabled: boolean };
const mockEnv = env as { UPDATE_POLICY: string };
// `__DEV__` is a Metro global; the tests flip it to exercise both guards.
const devGlobal = globalThis as unknown as { __DEV__: boolean };

type CheckResult = Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>;
type FetchResult = Awaited<ReturnType<typeof Updates.fetchUpdateAsync>>;

const available = (extra?: Record<string, unknown>): CheckResult =>
  ({
    isAvailable: true,
    isRollBackToEmbedded: false,
    manifest: { id: 'u1', extra: { expoClient: { name: 'x', slug: 'x', extra } } },
  }) as unknown as CheckResult;
const notAvailable = { isAvailable: false, isRollBackToEmbedded: false } as CheckResult;
const fetchedNew = { isNew: true } as FetchResult;

/** Mount the driver, wait for the launch run, and hand back the AppState handler it registered. */
async function mountDriver() {
  const addListener = jest.spyOn(AppState, 'addEventListener');
  const rendered = await renderHook(() => useUpdatePolicyDriver());
  await act(async () => {});
  const call = addListener.mock.calls.find(([event]) => event === 'change');
  if (!call) throw new Error('driver did not subscribe to AppState');
  const handler = call[1] as (state: AppStateStatus) => void;
  const emit = async (state: AppStateStatus) => {
    await act(async () => {
      handler(state);
    });
  };
  return { ...rendered, emit, addListener };
}

/** Background → (advance the clock) → active. */
async function resumeAfter(emit: (s: AppStateStatus) => Promise<void>, ms: number) {
  await emit('background');
  jest.setSystemTime(Date.now() + ms);
  await emit('active');
}

describe('useUpdatePolicy', () => {
  const originalDev = devGlobal.__DEV__;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-09-11T10:00:00Z') });
    devGlobal.__DEV__ = false;
    mockUpdates.isEnabled = true;
    mockEnv.UPDATE_POLICY = 'silent';
  });

  afterEach(() => {
    resetUpdatePolicyState();
    devGlobal.__DEV__ = originalDev;
    mockUpdates.isEnabled = false;
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('manual controls', () => {
    it('reports the policy from the environment', async () => {
      mockEnv.UPDATE_POLICY = 'opt-in';
      const { result } = await renderHook(() => useUpdatePolicy());
      expect(result.current.policy).toBe('opt-in');
      expect(result.current.isUpdateReady).toBe(false);
    });

    it('keeps its functions referentially stable across renders', async () => {
      const { result, rerender } = await renderHook(() => useUpdatePolicy());
      const first = result.current;
      await rerender(undefined);
      expect(result.current.checkForUpdate).toBe(first.checkForUpdate);
      expect(result.current.downloadAndReload).toBe(first.downloadAndReload);
      expect(result.current.restartNow).toBe(first.restartNow);
      expect(result.current.dismiss).toBe(first.dismiss);
    });

    it('skips in dev builds before touching expo-updates', async () => {
      devGlobal.__DEV__ = true;
      const { result } = await renderHook(() => useUpdatePolicy());
      await expect(result.current.checkForUpdate()).resolves.toEqual({ skipped: 'dev' });
      await expect(result.current.downloadAndReload()).resolves.toEqual({ skipped: 'dev' });
      await result.current.restartNow();
      expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
      expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
    });

    it('skips when updates are disabled', async () => {
      mockUpdates.isEnabled = false;
      const { result } = await renderHook(() => useUpdatePolicy());
      await expect(result.current.checkForUpdate()).resolves.toEqual({ skipped: 'disabled' });
      expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    });

    it('downloads and reloads only when the fetched update is new', async () => {
      const { result } = await renderHook(() => useUpdatePolicy());

      await expect(result.current.downloadAndReload()).resolves.toEqual({
        isNew: false,
        reloaded: false,
      });
      expect(Updates.reloadAsync).not.toHaveBeenCalled();

      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      await expect(result.current.downloadAndReload()).resolves.toEqual({
        isNew: true,
        reloaded: true,
      });
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('driver', () => {
    it('checks on launch and again on every foreground', async () => {
      const { emit, unmount, addListener } = await mountDriver();
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
      await emit('background');
      await emit('active');
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
      // `inactive` (iOS control centre) is not a foreground.
      await emit('inactive');
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
      expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
      const remove = addListener.mock.results[0]?.value.remove as jest.Mock;
      await unmount();
      expect(remove).toHaveBeenCalled();
    });

    it('does nothing in dev builds or when updates are disabled', async () => {
      devGlobal.__DEV__ = true;
      const dev = await mountDriver();
      await dev.emit('background');
      await dev.emit('active');
      expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
      await dev.unmount();

      devGlobal.__DEV__ = false;
      mockUpdates.isEnabled = false;
      const disabled = await mountDriver();
      await disabled.emit('background');
      await disabled.emit('active');
      expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    });

    it('silent: downloads in the background and never reloads', async () => {
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      const { result } = await renderHook(() => useUpdatePolicy());
      await mountDriver();
      expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
      expect(result.current.isUpdateReady).toBe(false);
    });

    it('opt-in: exposes the ready update, restarts on demand and can be dismissed', async () => {
      mockEnv.UPDATE_POLICY = 'opt-in';
      // Launch plus two foregrounds below all find the update available.
      jest
        .mocked(Updates.checkForUpdateAsync)
        .mockResolvedValueOnce(available())
        .mockResolvedValueOnce(available())
        .mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      const { result } = await renderHook(() => useUpdatePolicy());
      const { emit } = await mountDriver();
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
      expect(result.current.isUpdateReady).toBe(true);

      await act(async () => {
        result.current.dismiss();
      });
      expect(result.current.isUpdateReady).toBe(false);

      // The same (already downloaded) update on the next foreground stays dismissed…
      await emit('background');
      await emit('active');
      expect(result.current.isUpdateReady).toBe(false);

      // …a newly downloaded one shows the banner again.
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      await emit('background');
      await emit('active');
      expect(result.current.isUpdateReady).toBe(true);

      await act(async () => {
        await result.current.restartNow();
      });
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
    });

    it('forced via the build policy: downloads and reloads at once, flushing Sentry first', async () => {
      mockEnv.UPDATE_POLICY = 'forced';
      const { flushSentry } = jest.requireMock<typeof import('@/lib/sentry')>('@/lib/sentry');
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      await mountDriver();
      expect(Updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
      expect(jest.mocked(flushSentry).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(Updates.reloadAsync).mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('forced via the manifest flag: a critical update reloads under the silent policy', async () => {
      jest
        .mocked(Updates.checkForUpdateAsync)
        .mockResolvedValueOnce(available({ updatePolicy: 'forced' }));
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      await mountDriver();
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
    });

    it('ignores a manifest without the flag under the silent policy', async () => {
      jest
        .mocked(Updates.checkForUpdateAsync)
        .mockResolvedValueOnce(available({ updatePolicy: 'silent' }));
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      await mountDriver();
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
    });

    it('reloads a pending update on resume after 30 minutes in the background', async () => {
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      const { emit } = await mountDriver();
      expect(Updates.reloadAsync).not.toHaveBeenCalled();

      await resumeAfter(emit, RESUME_RELOAD_AFTER_MS);
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
      // The reload replaces the check on that resume.
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    });

    it('does not reload on resume after 5 minutes, or without a pending update', async () => {
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      const { emit } = await mountDriver();
      await resumeAfter(emit, 5 * 60 * 1000);
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(2);

      // Without a pending update (the default check finds nothing) the idle rule is inert.
      resetUpdatePolicyState();
      await resumeAfter(emit, RESUME_RELOAD_AFTER_MS);
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
    });

    it('starts the idle clock at background, not at inactive', async () => {
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValueOnce(fetchedNew);
      const { emit } = await mountDriver();
      await emit('inactive');
      jest.setSystemTime(Date.now() + RESUME_RELOAD_AFTER_MS);
      await emit('background');
      await emit('active');
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
    });

    it('swallows errors and reports them to Sentry', async () => {
      const failure = new Error('offline');
      jest.mocked(Updates.checkForUpdateAsync).mockRejectedValueOnce(failure);
      const { emit } = await mountDriver();
      expect(captureException).toHaveBeenCalledWith(failure, { source: 'update-policy' });

      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValueOnce(available());
      jest.mocked(Updates.fetchUpdateAsync).mockRejectedValueOnce(failure);
      await emit('background');
      await emit('active');
      expect(captureException).toHaveBeenCalledTimes(2);
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
    });

    it('shares one in-flight run between launch and a foreground', async () => {
      let resolveCheck: (value: CheckResult) => void = () => {};
      jest.mocked(Updates.checkForUpdateAsync).mockImplementationOnce(
        () =>
          new Promise<CheckResult>((resolve) => {
            resolveCheck = resolve;
          }),
      );
      const { emit } = await mountDriver();
      await emit('background');
      await emit('active');
      expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
      await act(async () => {
        resolveCheck(notAvailable);
      });
    });
  });
});
