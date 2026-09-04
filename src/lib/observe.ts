/**
 * EAS Observe (PLAN.md #5, #7): production performance telemetry — cold/warm launch,
 * TTR, per-route navigation TTR, and TTI where a screen calls `markInteractive`.
 *
 * The native module dispatches only when `extra.eas.projectId` is present in the app
 * config (`EAS_PROJECT_ID` in app.config.ts).
 * Debug builds / `__DEV__` bundles never dispatch (`dispatchInDebug: false`), Expo Go
 * has no native module, and web is a no-op. Sentry perf tracing stays off; this is the
 * one place to tune sampling.
 */
import { Observe, ObserveRoot } from 'expo-observe';

import { env } from '@/lib/env';

/**
 * Fraction of installations that report, deterministic per install. Non-production
 * variants have few installs, so sample everything; production trades volume for cost.
 */
const PRODUCTION_SAMPLE_RATE = 0.25;

function getObserveConfig() {
  const variant = env.APP_VARIANT ?? 'development';
  return {
    environment: variant,
    dispatchInDebug: false,
    sampleRate: variant === 'production' ? PRODUCTION_SAMPLE_RATE : 1,
    // Per-route metrics from Expo Router navigation events. Must be enabled before any
    // screen mounts (see `configureObserve`), and cannot be toggled at runtime.
    integrations: { 'expo-router': true as const },
  };
}

/**
 * Call once at module scope in the root layout, before the first render. Returns the
 * applied config so it can be inspected (tests, debug screens).
 */
export function configureObserve() {
  const config = getObserveConfig();
  Observe.configure(config);
  return config;
}

/** Wraps the root component: marks first render (TTR) and provides the router integration. */
export const wrapObserveRoot = ObserveRoot.wrap;
