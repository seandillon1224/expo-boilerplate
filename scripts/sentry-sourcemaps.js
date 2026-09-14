#!/usr/bin/env node
/**
 * Uploads the source maps from `expo export` (<repo>/dist) to Sentry after an EAS Update.
 * Local twin of what the `update` job in .eas/workflows/deploy-staging.yml does itself
 * (`upload_sentry_sourcemaps`, T5.1); run it with `bun run sentry:sourcemaps`.
 *
 * Requires build-time env (never EXPO_PUBLIC_*): SENTRY_AUTH_TOKEN, SENTRY_ORG and
 * SENTRY_PROJECT. Plain Node/JS, Node built-ins only so it needs no extra type packages.
 */
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { binPath, projectRoot } = require('./lib/bin');

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
// `eas update` writes ./dist; the repo's own `bun run export:<platform>` scripts write
// dist-web / dist-ios / dist-android instead, so export to `dist` before uploading.
const dist = path.join(projectRoot, 'dist');
if (!existsSync(dist)) {
  console.error(
    `sentry:sourcemaps: ${dist} not found. Run \`bun run eas update\` (it exports to dist/) or ` +
      '`expo export --output-dir dist` — `bun run export:web` writes dist-web, not dist.',
  );
  process.exit(1);
}

const result = spawnSync(binPath('sentry-expo-upload-sourcemaps'), [dist], {
  cwd: projectRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
