/**
 * Session — the demo auth flag behind `Stack.Protected` in `src/app/_layout.tsx` (T13.6).
 *
 * It is a *shape*, not an auth system: one boolean, no tokens, no refresh, no provider SDK, no
 * server check. `Stack.Protected` is client-side navigation only (Expo Router 57 → Protected
 * routes), so it hides screens; it never protects data. Everything that matters still has to be
 * authorised on the server.
 *
 * ---------------------------------------------------------------------------------------------
 * REMOVING THE DEMO (do this first if your app has no sign-in, or replace it with a real one)
 * ---------------------------------------------------------------------------------------------
 * 1. `src/app/_layout.tsx`: drop the `useSession()` call, the `isHydrated` gate and both
 *    `<Stack.Protected>` wrappers, leaving `<Stack.Screen name="(tabs)" />`.
 * 2. Delete `src/app/(auth)/`, this folder, `src/__tests__/features/use-session.test.ts`,
 *    `src/__tests__/screens/sign-in.test.tsx` and `src/__tests__/screens/session-guard.test.tsx`.
 * 3. `src/app/(tabs)/(settings)/settings.tsx`: drop the sign-out `Pressable`.
 * 4. Maestro: delete `.maestro/subflows/sign-in.yaml`, `.maestro/flows/session.yaml`,
 *    `.maestro/flows/web/session.yaml`, the `runFlow: ../sign-in.yaml` line in
 *    `subflows/launch.yaml` / `subflows/launch-web.yaml` and the `runFlow: ../sign-in.yaml`
 *    line in `subflows/steps/not-found.yaml`.
 * 5. `bun run i18n:extract` to drop the `signIn.*` / `settings.signOut` keys.
 *
 * To keep it and make it real: swap `hydrateSession` / `signIn` / `signOut` for your provider's
 * calls (and store the token in `expo-secure-store`, never AsyncStorage) — every consumer goes
 * through `useSession()`, so nothing above this module changes.
 *
 * ---------------------------------------------------------------------------------------------
 * Why an external store rather than a context provider
 * ---------------------------------------------------------------------------------------------
 * Same reason as `use-update-policy.ts`: the flag lives in a module-level snapshot and is read
 * with `useSyncExternalStore`, so flipping it re-renders only the components that read it — and
 * `signIn()` / `signOut()` are plain functions any module can call without a hook or a provider
 * in the tree. The persisted flag goes through AsyncStorage, the same storage the query cache
 * persister uses (`src/lib/query-client.ts`), so it works unchanged on web (localStorage).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { captureException } from '@/lib/sentry';

/** AsyncStorage key holding the demo flag. Namespaced like the query cache key. */
export const SESSION_STORAGE_KEY = 'expo-boilerplate-session';

type SessionSnapshot = {
  /** The guard for `<Stack.Protected>` around `(tabs)`. */
  isSignedIn: boolean;
  /** `false` until the persisted flag has been read; the root layout renders nothing before it. */
  isHydrated: boolean;
};

export type Session = SessionSnapshot & {
  /** Enter the app and persist the flag. */
  signIn: () => void;
  /** Leave the app and clear the persisted flag. */
  signOut: () => void;
};

// ---------------------------------------------------------------------------------------------
// Store. Module-level on purpose: one session per app instance, readable without a provider.
// ---------------------------------------------------------------------------------------------

const SIGNED_OUT: SessionSnapshot = { isSignedIn: false, isHydrated: false };

let snapshot: SessionSnapshot = SIGNED_OUT;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function setSnapshot(next: SessionSnapshot): void {
  if (next.isSignedIn === snapshot.isSignedIn && next.isHydrated === snapshot.isHydrated) return;
  // A fresh object every time: useSyncExternalStore compares snapshots by identity.
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SessionSnapshot {
  return snapshot;
}

/** Test-only: forget the session and the in-flight hydration (the module is a singleton). */
export function resetSessionState(): void {
  snapshot = SIGNED_OUT;
  hydration = null;
  emit();
}

// ---------------------------------------------------------------------------------------------
// Persistence.
// ---------------------------------------------------------------------------------------------

/**
 * Read the persisted flag exactly once per app start. Every caller shares the same promise, and a
 * read that fails still resolves: a broken storage read must not wedge the app on a blank screen,
 * it just means "signed out".
 */
export function hydrateSession(): Promise<void> {
  hydration ??= AsyncStorage.getItem(SESSION_STORAGE_KEY)
    .then((value) => {
      // A sign-in that raced the read wins: never demote a session the user just created.
      if (snapshot.isHydrated) return;
      setSnapshot({ isSignedIn: value === 'true', isHydrated: true });
    })
    .catch((error: unknown) => {
      captureException(error, { source: 'session-hydrate' });
      setSnapshot({ ...snapshot, isHydrated: true });
    });
  return hydration;
}

/** Fire-and-forget: the UI follows the in-memory flag, so a slow disk write never blocks it. */
async function persist(isSignedIn: boolean): Promise<void> {
  try {
    if (isSignedIn) await AsyncStorage.setItem(SESSION_STORAGE_KEY, 'true');
    else await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    captureException(error, { source: 'session-persist' });
  }
}

function signIn(): void {
  setSnapshot({ isSignedIn: true, isHydrated: true });
  void persist(true);
}

function signOut(): void {
  setSnapshot({ isSignedIn: false, isHydrated: true });
  void persist(false);
}

// ---------------------------------------------------------------------------------------------
// Hook.
// ---------------------------------------------------------------------------------------------

/**
 * Read the session and act on it. Kicks off hydration on first mount, so the root layout is the
 * only place that has to care about the gap between "app started" and "flag read".
 */
export function useSession(): Session {
  const { isSignedIn, isHydrated } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void hydrateSession();
  }, []);
  // Module-level functions are referentially stable, so no memoisation is needed.
  return { isSignedIn, isHydrated, signIn, signOut };
}
