#!/usr/bin/env node
/**
 * Local parity for the CI `secret-scan` job: runs gitleaks over the git history with the
 * repo's `.gitleaks.toml`. Plain Node/JS so it needs no extra type packages.
 *
 * gitleaks is optional locally — when it is not installed this prints an install hint and
 * exits 0 so the local gate does not hard-fail. CI always runs the real scan.
 */
const { spawnSync } = require('node:child_process');

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
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
