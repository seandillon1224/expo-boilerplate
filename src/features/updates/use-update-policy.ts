/**
 * Update policy — the single place that decides how the app applies OTA updates (ADR-0003).
 *
 * Build-level policy comes from `EXPO_PUBLIC_UPDATE_POLICY` (`@/lib/env`):
 * - `silent` (default): check on launch and on every foreground; download in the background;
 *   the update applies on the next cold start or on an idle resume (below). No UI.
 * - `opt-in`: same, plus `isUpdateReady` for the top banner (`update-banner.tsx`) with
 *   `restartNow()` / `dismiss()`; "Later" hides the banner until the next downloaded update.
 * - `forced`: every downloaded update reloads immediately.
 *
 * Per-update override: a critical publish (`EAS_UPDATE_CRITICAL=1`, see app.config.ts) carries
 * `extra.expoClient.extra.updatePolicy: 'forced'` in its manifest; the driver reads it from the
 * *incoming* update on a successful check and reloads at once whatever the build policy says.
 *
 * Idle resume (every policy): coming back to the foreground after ≥ `RESUME_RELOAD_AFTER_MS` in
 * the background with an update already downloaded reloads into it before the user resumes work.
 *
 * `useUpdatePolicyDriver()` is mounted once by the root layout; screens never call expo-updates.
 * Every action no-ops (returning `{ skipped }`) in dev builds and wherever `Updates.isEnabled` is
 * false (dev client, web, no EAS project yet), so callers never need their own guards. Driver
 * errors are reported to Sentry and never surface in the UI. Banner state lives in a tiny
 * external store so the root layout never re-renders because of it.
 */
import * as Updates from 'expo-updates';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { env } from '@/lib/env';
import type { UpdatePolicy } from '@/lib/env.schema';
import { captureException, flushSentry } from '@/lib/sentry';

export type { UpdatePolicy } from '@/lib/env.schema';

export type SkipReason = 'disabled' | 'dev';

/** Background time after which a resume reloads into an already-downloaded update. */
export const RESUME_RELOAD_AFTER_MS = 30 * 60 * 1000;

type CheckForUpdateResult = { skipped: SkipReason } | { skipped?: undefined; isAvailable: boolean };

type DownloadAndReloadResult =
  { skipped: SkipReason } | { skipped?: undefined; isNew: boolean; reloaded: boolean };

export type UpdatePolicyControls = {
  /** Build-level policy from `EXPO_PUBLIC_UPDATE_POLICY`. */
  policy: UpdatePolicy;
  /** `opt-in` only: a downloaded update is waiting and the banner has not been dismissed. */
  isUpdateReady: boolean;
  /** Reload into the downloaded update now (flushes Sentry first). */
  restartNow: () => Promise<void>;
  /** Hide the banner until the next downloaded update; the idle-resume rule still applies. */
  dismiss: () => void;
  /** Ask the update server whether a newer update exists for this runtime/channel. */
  checkForUpdate: () => Promise<CheckForUpdateResult>;
  /** Download the latest update and restart into it. Resolves (without reloading) if none was new. */
  downloadAndReload: () => Promise<DownloadAndReloadResult>;
};

// ---------------------------------------------------------------------------------------------
// Driver state. Module-level on purpose: the driver is mounted once, nothing renders on these
// flags except the banner (through the external store below).
// ---------------------------------------------------------------------------------------------

/** An update newer than the running one is on disk and will launch on the next start. */
let hasPendingUpdate = false;
/** "Later" was pressed for the currently downloaded update. */
let dismissed = false;
/** When the app last went to the background (`null` while active). */
let backgroundedAt: number | null = null;
/** The in-flight policy run, so launch + foreground never race two checks. */
let inFlight: Promise<void> | null = null;

let isUpdateReady = false;
const listeners = new Set<() => void>();

function setUpdateReady(next: boolean): void {
  if (isUpdateReady === next) return;
  isUpdateReady = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getUpdateReady(): boolean {
  return isUpdateReady;
}

/** Test-only: forget everything the driver learned (the module is a singleton). */
export function resetUpdatePolicyState(): void {
  hasPendingUpdate = false;
  dismissed = false;
  backgroundedAt = null;
  inFlight = null;
  setUpdateReady(false);
}

// ---------------------------------------------------------------------------------------------
// Primitives shared by the driver and the manual controls.
// ---------------------------------------------------------------------------------------------

function skipReason(): SkipReason | null {
  if (__DEV__) return 'dev';
  if (!Updates.isEnabled) return 'disabled';
  return null;
}

/** `true` when the incoming update was published with `EAS_UPDATE_CRITICAL=1`. */
function isCriticalManifest(manifest: Updates.Manifest | undefined): boolean {
  if (!manifest || !('extra' in manifest)) return false;
  return manifest.extra?.expoClient?.extra?.updatePolicy === 'forced';
}

/** Restart into the downloaded update. Pending Sentry events would be lost otherwise. */
async function reloadNow(): Promise<void> {
  await flushSentry();
  await Updates.reloadAsync();
}

async function checkForUpdate(): Promise<CheckForUpdateResult> {
  const skipped = skipReason();
  if (skipped) return { skipped };
  const result = await Updates.checkForUpdateAsync();
  return { isAvailable: result.isAvailable };
}

async function downloadAndReload(): Promise<DownloadAndReloadResult> {
  const skipped = skipReason();
  if (skipped) return { skipped };
  const result = await Updates.fetchUpdateAsync();
  if (!result.isNew) return { isNew: false, reloaded: false };
  await reloadNow();
  return { isNew: true, reloaded: true };
}

// ---------------------------------------------------------------------------------------------
// The policy itself.
// ---------------------------------------------------------------------------------------------

async function applyPolicy(): Promise<void> {
  const check = await Updates.checkForUpdateAsync();
  // A rollback directive counts as an update to fetch; anything else with nothing new is done.
  if (!check.isAvailable && !check.isRollBackToEmbedded) return;

  const forced = env.UPDATE_POLICY === 'forced' || isCriticalManifest(check.manifest);
  // Either a fresh download (`isNew`) or the same update already fetched natively by
  // `checkAutomatically: ON_LOAD`; both mean it is on disk and launches next start.
  const fetched = await Updates.fetchUpdateAsync();
  hasPendingUpdate = true;

  if (forced) {
    await reloadNow();
    return;
  }
  if (fetched.isNew) dismissed = false;
  if (env.UPDATE_POLICY === 'opt-in' && !dismissed) setUpdateReady(true);
}

/** One check → fetch → decide cycle; concurrent callers share the in-flight run. */
function runUpdatePolicy(): Promise<void> {
  if (skipReason()) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = applyPolicy()
    .catch((error: unknown) => {
      captureException(error, { source: 'update-policy' });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function restartNow(): Promise<void> {
  if (skipReason()) return;
  try {
    await reloadNow();
  } catch (error) {
    captureException(error, { source: 'update-policy-restart' });
  }
}

function dismiss(): void {
  dismissed = true;
  setUpdateReady(false);
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === 'background') {
    // iOS passes through `inactive` first (and on its own for Control Center); only a real
    // background starts the idle clock.
    backgroundedAt ??= Date.now();
    return;
  }
  if (next !== 'active') return;
  const idleFor = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
  backgroundedAt = null;
  if (skipReason()) return;
  if (hasPendingUpdate && idleFor >= RESUME_RELOAD_AFTER_MS) {
    reloadNow().catch((error: unknown) => {
      captureException(error, { source: 'update-policy-resume' });
    });
    return;
  }
  void runUpdatePolicy();
}

/**
 * Mount once from the root layout. Runs the policy on launch and on every return to the
 * foreground; holds no React state, so it never adds a render to the tree below it.
 */
export function useUpdatePolicyDriver(): void {
  useEffect(() => {
    void runUpdatePolicy();
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => subscription.remove();
  }, []);
}

/** Controls for the Updates screen (manual test bed) and the opt-in banner. */
export function useUpdatePolicy(): UpdatePolicyControls {
  const ready = useSyncExternalStore(subscribe, getUpdateReady, getUpdateReady);
  // Module-level functions are referentially stable, so no memoisation is needed.
  return {
    policy: env.UPDATE_POLICY,
    isUpdateReady: ready,
    restartNow,
    dismiss,
    checkForUpdate,
    downloadAndReload,
  };
}
