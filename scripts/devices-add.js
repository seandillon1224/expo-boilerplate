// `bun run devices:add` — register an iPhone / iPad for internal-distribution (ad hoc) builds.
// Thin wrapper around `eas device:create` (repo-pinned eas-cli) that checks the EAS login first
// and prints the two-line explainer engineers otherwise have to look up. Extra args pass through
// (for example `--apple-team-id ABCDE12345`). Non-engineer walkthrough: docs/device-onboarding.md.
const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const easBin = path.join(projectRoot, 'node_modules', '.bin', 'eas');

function eas(args, options = {}) {
  return spawnSync(easBin, args, { cwd: projectRoot, encoding: 'utf8', ...options });
}

const whoami = eas(['whoami', '--non-interactive']);
if (whoami.status !== 0) {
  console.error(
    [
      'devices:add: not logged in to EAS.',
      'Run `bun run eas login` (or set EXPO_TOKEN) and try again.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  [
    `Registering a test device as ${whoami.stdout.trim().split('\n')[0]}.`,
    '',
    'iOS internal builds (development / staging / uat) only install on phones whose UDID is in the',
    "team's ad hoc provisioning profile. This adds one. When asked how to register, pick",
    '  Website  → EAS prints a link + QR code; send it to the tester, they open it on the phone.',
    '  Input    → paste a UDID you already have (engineers only).',
    'You can answer "no" to the Apple login prompt and type the Apple Team ID instead.',
    'After the tester installs the profile, the next iOS build picks the device up',
    '(docs/device-onboarding.md → "After a device is registered").',
    '',
  ].join('\n'),
);

const result = eas(['device:create', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
