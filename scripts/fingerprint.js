// Prints the native fingerprint (PLAN.md decision 2) for both platforms as JSON, e.g.
// `{"ios":"9508…","android":"2ed5…"}`. This is the value EAS uses as `runtimeVersion`
// (`policy: 'fingerprint'` in app.config.ts): an update only reaches builds with the same hash.
// Pass `--platform ios|android` to print one hash as a bare string (handy in workflows).
// Add `--debug` to also print every source that fed the hash (`sources`), for diffing.
const path = require('path');
const { createFingerprintAsync } = require('@expo/fingerprint');

const { parseArgs, runMain } = require('./lib/args');

const projectRoot = path.join(__dirname, '..');

const CLI = {
  name: 'fingerprint',
  usage: `Usage: bun run fingerprint [--platform ios|android] [--debug]

Prints the @expo/fingerprint hash of the current tree — the value EAS uses as runtimeVersion.

Options:
  --platform ios|android   print this platform's hash as a bare string (default: both, as JSON)
  --debug                  print every source that fed the hash, for diffing
  --help                   this text`,
  options: {
    platform: { type: 'string', choices: ['ios', 'android'] },
    debug: { type: 'boolean' },
  },
};

async function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;

  const only = values.platform;
  const debug = values.debug;
  const result = {};
  for (const platform of only ? [only] : ['ios', 'android']) {
    const fingerprint = await createFingerprintAsync(projectRoot, { platforms: [platform], debug });
    result[platform] = debug ? fingerprint : fingerprint.hash;
  }
  process.stdout.write(
    only && !debug ? `${result[only]}\n` : `${JSON.stringify(result, null, debug ? 2 : 0)}\n`,
  );
  return 0;
}

runMain(main);
