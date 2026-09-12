// Native fingerprint options (PLAN.md decision 2; ADR-0002). Loaded by every fingerprint path —
// `bun run fingerprint`, the EAS `fingerprint` job, `eas build`, and the expo-updates runtime
// version (`policy: 'fingerprint'`) — through @expo/fingerprint's `normalizeOptionsAsync`.
//
// `version` in the Expo config is hashed by default, so the release-please bump alone would make
// every release look like a native change: staging builds, and `release.yml` could never skip an
// unchanged fingerprint. Verified on this repo: the iOS hash moved c7aa60… → 907d6e… on a version
// bump without this file, and stayed at 24e465… before and after the same bump with it. Adding
// the file changes the hash once (one round of staging builds on the merge that introduces it).
//
// `extra` is JS-only (it ships in the manifest / `Constants.expoConfig`, never in native code), but
// it is hashed by default too — and app.config.ts writes `extra.updatePolicy: 'forced'` there for a
// critical publish (`EAS_UPDATE_CRITICAL=1`, ADR-0003). Verified: with only `ExpoConfigVersions`
// skipped the iOS hash moved 24e465… → 901742… under that flag, so a critical `eas update` would
// have computed a runtime version no build matches and reached nobody. `ExpoConfigExtraSection`
// keeps the whole section out of the hash (same hash with and without the flag); like every
// change to this file it moves the hash once, on the merge that introduces it.
const { SourceSkips } = require('@expo/fingerprint');

/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  sourceSkips: SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigExtraSection,
};
