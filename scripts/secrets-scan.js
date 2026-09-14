#!/usr/bin/env node
/**
 * Local parity for the CI `secret-scan` job: runs gitleaks over the git history with the
 * repo's `.gitleaks.toml`.
 *
 * gitleaks is optional locally — when it is not installed this prints an install hint and
 * exits 0 so the local gate does not hard-fail. CI always runs the real scan.
 *
 * Scans this repo, resolved from __dirname — not `process.cwd()`, so it scans the same history
 * whichever directory it is run from. Plain Node/JS, Node built-ins only.
 */
const { spawnSync } = require('node:child_process');

const { projectRoot } = require('./lib/bin');

const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore' });
if (probe.error) {
  console.warn(
    'secrets:scan: gitleaks is not installed; skipping (CI still runs it). ' +
      'Install with `brew install gitleaks` — https://github.com/gitleaks/gitleaks#installing',
  );
  process.exit(0);
}

const result = spawnSync(
  'gitleaks',
  ['git', '--no-banner', '--redact', '--exit-code', '1', '--config', '.gitleaks.toml', '.'],
  { cwd: projectRoot, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
