import * as Updates from 'expo-updates';

export type UpdateInfo = {
  /** Native fingerprint of the running build (`runtimeVersion.policy = 'fingerprint'`). */
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;
  /** True when running the bundle embedded in the binary rather than an OTA update. */
  isEmbeddedLaunch: boolean;
  /** False in dev clients, on web, and when `updates.enabled` is off. */
  isEnabled: boolean;
  createdAt: Date | null;
  checkAutomatically: Updates.UpdatesCheckAutomaticallyValue | null;
  /** Live state from `useUpdates()` (check / download in flight, available update, errors). */
  isChecking: boolean;
  isDownloading: boolean;
  isUpdatePending: boolean;
  availableUpdate: Updates.UseUpdatesReturnType['availableUpdate'];
  checkError: Error | undefined;
  downloadError: Error | undefined;
};

/**
 * Read-only snapshot of the expo-updates runtime for diagnostics screens and Sentry tags.
 * Safe everywhere: when updates are disabled (dev client, web) the constants are
 * `null` / `false` and `useUpdates()` reports an idle state.
 */
export function useUpdateInfo(): UpdateInfo {
  const { isChecking, isDownloading, isUpdatePending, availableUpdate, checkError, downloadError } =
    Updates.useUpdates();

  return {
    runtimeVersion: Updates.runtimeVersion ?? null,
    channel: Updates.channel ?? null,
    updateId: Updates.updateId ?? null,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch ?? true,
    isEnabled: Updates.isEnabled ?? false,
    createdAt: Updates.createdAt ?? null,
    checkAutomatically: Updates.checkAutomatically ?? null,
    isChecking,
    isDownloading,
    isUpdatePending,
    availableUpdate,
    checkError,
    downloadError,
  };
}
