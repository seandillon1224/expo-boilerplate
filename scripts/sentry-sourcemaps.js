#!/usr/bin/env node
/**
 * Uploads the source maps from `expo export` (./dist) to Sentry after an EAS Update.
 * Used by the deploy workflows (T5.1); locally: `bun run sentry:sourcemaps`.
 *
 * Requires build-time env (never EXPO_PUBLIC_*): SENTRY_AUTH_TOKEN, SENTRY_ORG and
 * SENTRY_PROJECT. Plain Node/JS so it needs no extra type packages.
 */
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].filter(
  (key) => !process.env[key],
);
if (missing.length > 0) {
  console.error(
    `sentry:sourcemaps: missing ${missing.join(', ')}. Set them in the environment ` +
      '(EAS environment variables, sensitive visibility) — see .env.example.',
  );
  process.exit(1);
}
if (!existsSync('dist')) {
  console.error('sentry:sourcemaps: ./dist not found. Run `eas update` or `expo export` first.');
  process.exit(1);
}

const result = spawnSync('bunx', ['sentry-expo-upload-sourcemaps', 'dist'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
