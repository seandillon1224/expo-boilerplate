/**
 * Sentry error reporting. A no-op unless `EXPO_PUBLIC_SENTRY_DSN` is set, so the
 * template runs without a Sentry account and dev builds never report.
 *
 * Performance tracing is deliberately OFF (PLAN.md #7: EAS Observe owns prod
 * telemetry). Source maps are matched via Metro Debug IDs (see metro.config.js),
 * so `release` / `dist` are left to the SDK's native defaults
 * (`<bundleId>@<version>+<build>` / `<build>`); overriding `dist` with the update id
 * (the legacy sentry-expo pattern) would break matching for the embedded bundle.
 * The SDK's ExpoContext integration attaches an `ota_updates` context automatically;
 * the tags below make the same values searchable in the issue stream.
 */
import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

import { env } from '@/lib/env';

export function initSentry(): boolean {
  if (!env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    enabled: !__DEV__,
    environment: env.APP_VARIANT ?? 'development',
    sendDefaultPii: false,
    // Errors only; no transactions, app-start spans or frame tracking.
    tracesSampleRate: 0,
    enableAutoPerformanceTracing: false,
    enableAppStartTracking: false,
    enableNativeFramesTracking: false,
  });
  tagUpdateState();
  return true;
}

/**
 * Searchable OTA state on every event: which update / channel / runtime a report came
 * from. All values are null/false when updates are disabled (dev client, web).
 */
function tagUpdateState(): void {
  Sentry.setTag('update_id', Updates.updateId ?? 'embedded');
  Sentry.setTag('channel', Updates.channel ?? 'none');
  Sentry.setTag('runtime_version', Updates.runtimeVersion ?? 'unknown');
  Sentry.setTag('is_embedded_launch', String(Updates.isEmbeddedLaunch));
  Sentry.setContext('expo_updates', {
    is_enabled: Updates.isEnabled,
    update_id: Updates.updateId,
    channel: Updates.channel,
    runtime_version: Updates.runtimeVersion,
    is_embedded_launch: Updates.isEmbeddedLaunch,
    created_at: Updates.createdAt?.toISOString() ?? null,
    check_automatically: Updates.checkAutomatically,
  });
}

/** Send queued events now. Call before `Updates.reloadAsync()` so nothing is lost. */
export async function flushSentry(): Promise<void> {
  await Sentry.flush();
}

/** Report a handled error. Safe to call when Sentry is not initialised. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Wraps the root component (touch/gesture instrumentation, error boundary). */
export const wrapRoot = Sentry.wrap;
