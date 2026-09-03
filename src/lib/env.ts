/**
 * Parsed, typed `EXPO_PUBLIC_*` configuration for the app.
 *
 * Policy on invalid configuration:
 * - Development (`__DEV__`): throw at import time with every issue listed, so a
 *   bad `.env` is caught the moment the bundle loads.
 * - Production: log via `console.error` and fall back to schema defaults. An
 *   optional key (e.g. a malformed Sentry DSN) must never hard-crash a shipped
 *   build; `bun run env:check` in CI is the gate that keeps it from shipping.
 */
import type { Env } from '@/lib/env.schema';
import { formatEnvIssues, parseEnv, readRawEnv } from '@/lib/env.schema';

const result = parseEnv(readRawEnv());

if (!result.success) {
  const message = `Invalid EXPO_PUBLIC_* environment:\n${formatEnvIssues(result.issues)}`;
  if (__DEV__) {
    throw new Error(message);
  }
  console.error(`${message}\nFalling back to defaults.`);
}

export const env: Env = result.success ? result.env : result.fallback;

/**
 * Explicit startup hook. Parsing already ran at import time; calling this from
 * the root layout makes the dependency visible and keeps the import from being
 * tree-shaken as unused.
 */
export function assertEnv(): Env {
  return env;
}
