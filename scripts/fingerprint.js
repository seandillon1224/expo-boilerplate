// Prints the native fingerprint (PLAN.md decision 2) for both platforms as JSON, e.g.
// `{"ios":"9508…","android":"2ed5…"}`. This is the value EAS uses as `runtimeVersion`
// (`policy: 'fingerprint'` in app.config.ts): an update only reaches builds with the same hash.
// Pass `--platform ios|android` to print one hash as a bare string (handy in workflows).
// Add `--debug` to also print every source that fed the hash (`sources`), for diffing.
const path = require('path');
const { createFingerprintAsync } = require('@expo/fingerprint');

const projectRoot = path.join(__dirname, '..');
const args = process.argv.slice(2);
const debug = args.includes('--debug');
const platformIndex = args.indexOf('--platform');
const only = platformIndex === -1 ? null : args[platformIndex + 1];
const platforms = only ? [only] : ['ios', 'android'];

(async () => {
  const result = {};
  for (const platform of platforms) {
    const fingerprint = await createFingerprintAsync(projectRoot, { platforms: [platform], debug });
    result[platform] = debug ? fingerprint : fingerprint.hash;
  }
  process.stdout.write(
    only && !debug ? `${result[only]}\n` : `${JSON.stringify(result, null, debug ? 2 : 0)}\n`,
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
