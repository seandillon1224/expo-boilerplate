/**
 * Sentry error reporting. A no-op unless `EXPO_PUBLIC_SENTRY_DSN` is set, so the
 * template runs without a Sentry account and dev builds never report.
 *
 * Performance tracing is deliberately OFF (PLAN.md #7: EAS Observe owns prod
 * telemetry). Source maps are matched via Metro Debug IDs (see metro.config.js),
 * so `release` / `dist` are left to the SDK's native defaults.
 */
import * as Sentry from '@sentry/react-native';

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
    // TODO(#17): tag events with expo-updates `updateId` / `channel` / runtimeVersion
    // once expo-updates is installed.
  });
  return true;
}

/** Report a handled error. Safe to call when Sentry is not initialised. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

/** Wraps the root component (touch/gesture instrumentation, error boundary). */
export const wrapRoot = Sentry.wrap;
