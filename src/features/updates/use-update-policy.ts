/**
 * Update policy hook — the single place that decides how the app applies OTA updates.
 *
 * Stub — D3 (T9.3, issue #62) fills in forced/opt-in/silent behaviour and rollout %.
 * For now the policy is `manual`: nothing happens unless the user presses a button on
 * the Updates screen. Both actions no-op (returning `{ skipped }`) in dev builds and
 * wherever `Updates.isEnabled` is false (dev client, web, no EAS project yet), so
 * callers never need their own guards.
 */
import * as Updates from 'expo-updates';

import { flushSentry } from '@/lib/sentry';

export type UpdatePolicy = 'manual' | 'forced' | 'opt-in' | 'silent';

export type SkipReason = 'disabled' | 'dev';

type CheckForUpdateResult = { skipped: SkipReason } | { skipped?: undefined; isAvailable: boolean };

type DownloadAndReloadResult =
  { skipped: SkipReason } | { skipped?: undefined; isNew: boolean; reloaded: boolean };

export type UpdatePolicyControls = {
  policy: UpdatePolicy;
  /** Ask the update server whether a newer update exists for this runtime/channel. */
  checkForUpdate: () => Promise<CheckForUpdateResult>;
  /** Download the latest update and restart into it. Resolves (without reloading) if none was new. */
  downloadAndReload: () => Promise<DownloadAndReloadResult>;
};

function skipReason(): SkipReason | null {
  if (__DEV__) return 'dev';
  if (!Updates.isEnabled) return 'disabled';
  return null;
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
  // Pending Sentry events would be lost when the JS bundle restarts.
  await flushSentry();
  await Updates.reloadAsync();
  return { isNew: true, reloaded: true };
}

export function useUpdatePolicy(): UpdatePolicyControls {
  // Module-level functions are referentially stable, so no memoisation is needed.
  return { policy: 'manual', checkForUpdate, downloadAndReload };
}
