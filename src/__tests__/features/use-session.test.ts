import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';
import { act, renderHook } from '@testing-library/react-native';

import {
  hydrateSession,
  resetSessionState,
  SESSION_STORAGE_KEY,
  useSession,
} from '@/features/session/use-session';

// The store is a module singleton; every test starts from a cleared one. Only the Sentry spy is
// reset: `jest.clearAllMocks()` would also wipe the AsyncStorage mock's own implementations.
beforeEach(async () => {
  resetSessionState();
  await AsyncStorage.clear();
  jest.mocked(Sentry.captureException).mockClear();
});

describe('useSession', () => {
  it('starts signed out and un-hydrated, then hydrates from an empty store', async () => {
    const { result } = await renderHook(() => useSession());
    // Hydration is kicked off by the mount effect; the first snapshot is the pre-read one.
    await act(async () => {
      await hydrateSession();
    });
    expect(result.current.isSignedIn).toBe(false);
    expect(result.current.isHydrated).toBe(true);
  });

  it('hydrates a persisted session', async () => {
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, 'true');
    const { result } = await renderHook(() => useSession());
    await act(async () => {
      await hydrateSession();
    });
    expect(result.current.isSignedIn).toBe(true);
    expect(result.current.isHydrated).toBe(true);
  });

  it('signs in, persists the flag, and signs out again', async () => {
    const { result } = await renderHook(() => useSession());
    await act(async () => {
      result.current.signIn();
    });
    expect(result.current.isSignedIn).toBe(true);
    expect(await AsyncStorage.getItem(SESSION_STORAGE_KEY)).toBe('true');

    await act(async () => {
      result.current.signOut();
    });
    expect(result.current.isSignedIn).toBe(false);
    expect(await AsyncStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('does not let a slow read demote a session created while it was in flight', async () => {
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, 'false');
    const { result } = await renderHook(() => useSession());
    await act(async () => {
      result.current.signIn();
      await hydrateSession();
    });
    expect(result.current.isSignedIn).toBe(true);
  });

  // `mockRejectedValueOnce` rather than `spyOn`: AsyncStorage is already a jest mock here, so a
  // spy would be the same function and `mockRestore()` would strip its implementation for good.
  it('reports a failed read and still finishes hydrating', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    const { result } = await renderHook(() => useSession());
    await act(async () => {
      await hydrateSession();
    });
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.isSignedIn).toBe(false);
    expect(jest.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'disk' }),
      { extra: { source: 'session-hydrate' } },
    );
  });

  it('reports a failed write without changing the in-memory session', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('full'));
    const { result } = await renderHook(() => useSession());
    await act(async () => {
      result.current.signIn();
    });
    expect(result.current.isSignedIn).toBe(true);
    expect(jest.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'full' }),
      { extra: { source: 'session-persist' } },
    );
  });
});
