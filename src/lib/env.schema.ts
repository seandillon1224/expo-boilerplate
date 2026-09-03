/**
 * Pure Zod schema for the `EXPO_PUBLIC_*` variables the app reads.
 *
 * This module must stay free of React Native / Expo imports (and `__DEV__`) so
 * the same schema is consumed by both the app (`@/lib/env`) and the Bun CLI
 * (`scripts/env-check.ts`).
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time, but only for literal
 * member accesses — never read them dynamically (`process.env[name]`).
 * https://docs.expo.dev/guides/environment-variables/
 */
import { z } from 'zod';

/** Mirrors `APP_VARIANT` in `app.config.ts`; set per EAS build profile. */
const APP_VARIANTS = ['development', 'staging', 'uat', 'production'] as const;

/** Empty string (unset in `.env`) is treated as "not provided". */
const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed === '' ? undefined : trimmed;
  });

export const envSchema = z.object({
  /** Base URL for the demo API; consumers append their own paths. */
  EXPO_PUBLIC_API_URL: optionalString.pipe(
    z.url({ protocol: /^https?$/ }).default('https://jsonplaceholder.typicode.com'),
  ),
  /** Sentry DSN; wired up by the Sentry ticket. Absent means "reporting disabled". */
  EXPO_PUBLIC_SENTRY_DSN: optionalString.pipe(z.url().optional()),
  /** Mirrors `APP_VARIANT` so runtime code can branch on the installed variant. */
  EXPO_PUBLIC_APP_VARIANT: optionalString.pipe(z.enum(APP_VARIANTS).optional()),
});

export type EnvInput = z.input<typeof envSchema>;
type ParsedEnv = z.output<typeof envSchema>;

/** Public-facing shape: schema keys with the `EXPO_PUBLIC_` prefix stripped. */
export type Env = {
  API_URL: ParsedEnv['EXPO_PUBLIC_API_URL'];
  SENTRY_DSN: ParsedEnv['EXPO_PUBLIC_SENTRY_DSN'];
  APP_VARIANT: ParsedEnv['EXPO_PUBLIC_APP_VARIANT'];
};

export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof EnvInput)[];

/**
 * Snapshot of the raw variables. Each key is a literal `process.env.EXPO_PUBLIC_X`
 * access so Expo's build-time inlining can see it.
 */
export function readRawEnv(): EnvInput {
  return {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    EXPO_PUBLIC_APP_VARIANT: process.env.EXPO_PUBLIC_APP_VARIANT,
  };
}

function toEnv(parsed: ParsedEnv): Env {
  return {
    API_URL: parsed.EXPO_PUBLIC_API_URL,
    SENTRY_DSN: parsed.EXPO_PUBLIC_SENTRY_DSN,
    APP_VARIANT: parsed.EXPO_PUBLIC_APP_VARIANT,
  };
}

export type EnvIssue = { key: string; message: string };

export type ParseEnvResult =
  { success: true; env: Env } | { success: false; issues: EnvIssue[]; fallback: Env };

/** Parse raw input; on failure also return the all-defaults fallback. */
export function parseEnv(raw: EnvInput): ParseEnvResult {
  const result = envSchema.safeParse(raw);
  if (result.success) {
    return { success: true, env: toEnv(result.data) };
  }
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      key: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    })),
    fallback: toEnv(envSchema.parse({})),
  };
}

export function formatEnvIssues(issues: EnvIssue[]): string {
  return issues.map((issue) => `  - ${issue.key}: ${issue.message}`).join('\n');
}
