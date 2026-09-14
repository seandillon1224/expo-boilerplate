# ADR-0003: Update policies — silent, opt-in, forced, critical

- **Status:** Accepted
- **Date:** 2026-09-11
- **Issue:** #62 (D3 update policies; the grill outcome is the last comment on the issue). Pipeline
  half: #137.

## Context

The OTA rungs of the ladder (PLAN.md decisions 3, 9) publish to `staging` on every merge and
promote the same update group to `uat` and `production`, but the installed app only ever ran
expo-updates' native default: check on launch, download in the background, apply on the next cold
start. `useUpdatePolicy` was a stub (`manual`) behind the Updates screen's buttons. Missing were a
way to say "this update must land now" (a bad-data hotfix), a way for testers to always run the
newest group without relaunching, an opt-in prompt for production users, staged production
rollouts, and a rule for the very common case of an app that is never cold-started for days.

## Decision

1. **Default policy = `silent`.** expo-updates' native behaviour (check on launch, download in the
   background, apply on the next process start) plus the idle-resume rule below. No UI.
2. **`forced` is per update, not per build.** A publish-time variable (`EAS_UPDATE_CRITICAL=1`,
   never `EXPO_PUBLIC_`) makes `app.config.ts` write `extra.updatePolicy: 'forced'` into the update
   manifest. The running app reads that field from the **incoming** update's manifest on a
   successful check (`checkForUpdateAsync().manifest.extra.expoClient.extra.updatePolicy`) and,
   when set, downloads and reloads immediately (Sentry flushed first). Republish / promote carries
   the flag unchanged.
3. **Idle-resume reload.** When the app returns to the foreground after ≥ `RESUME_RELOAD_AFTER_MS`
   (30 min, a code constant next to the hook) in the background and an update is already
   downloaded, reload into it. Applies to every policy. A check also runs on every foreground, not
   only on launch.
4. **Staged rollouts.** `rollout_percentage` input on `promote.yml` (default 100, honoured only for
   `target=production`, passed to `eas update:republish --rollout-percentage`). Ramp-up is
   `rollout.yml` (EAS `update-rollout` job behind an approval, #145), with `eas update:edit` as
   the CLI fallback; the runbook documents ending a bad rollout (`eas update:rollback`). UAT is
   always 100. (#137)
5. **App-level policy from env.** `EXPO_PUBLIC_UPDATE_POLICY` in the Zod schema: `silent`
   (default) | `opt-in` | `forced`. Set per EAS environment; recommended `forced` on `preview`
   (staging / UAT testers always run the newest) and `silent` on `production`. Build-level
   `forced` means every downloaded update reloads immediately.
6. **Opt-in UI.** A non-blocking top banner ("Update ready" — Restart now / Later) built with the
   project's component and i18n conventions, `testID`s on both buttons. "Later" hides it until the
   next downloaded update; idle resume still applies.
7. **Single mount.** The policy driver runs once from the root layout (`src/app/_layout.tsx`);
   screens never call expo-updates. `useUpdatePolicy` stays the only place that changes behaviour,
   `useUpdateInfo` stays read-only. The Updates screen keeps its manual check / download buttons
   as the test bed and shows the active policy.
8. **Delivery = two PRs.** PR 1 (#62): the app side — hook, env var, banner, root mount, Updates
   screen policy row, `app.config.ts` extra, Jest tests with mocked expo-updates, docs, this
   record. PR 2 (#137): the pipeline side — `rollout_percentage` and `critical` workflow inputs,
   runbook sections including how to verify each policy on staging.
9. **Verification.** Unit tests only in CI; real forced / rollout checks need a staging build with
   updates enabled (owner-owed, paid). The docs describe the manual check.

## Consequences

- The reload on idle resume is **app-initiated**: expo-updates never restarts the app by itself,
  so the driver calls `reloadAsync()` from the `AppState` `active` transition. Anything the user
  was doing in a resumed session is lost at that moment; the 30-minute floor is what makes that
  acceptable, and a project that keeps long-lived unsaved state should raise the constant.
- Verifying `forced`, the critical flag and rollouts needs a **staging build with updates
  enabled** on a device — a paid EAS build and an owner-owed step; Jest only proves the decision
  logic against a mocked `expo-updates`.
- `extra` had to leave the native fingerprint (`SourceSkips.ExpoConfigExtraSection` in
  `fingerprint.config.js`): a critical publish changed the iOS hash (`24e465…` → `901742…`), so it
  would have computed a runtime version no build matches and reached nobody. The skip is safe —
  `extra` ships in the manifest, not in native code — and moves the hash once (`fe0fc6…`), i.e.
  one round of staging builds on the merge that introduces it.
- `EXPO_PUBLIC_UPDATE_POLICY` is a new optional EAS variable; unset means `silent`, so nothing
  changes for existing environments until the owner sets `forced` on `preview`.
- The `manual` policy is gone: the Updates screen's buttons remain, but they are now a test bed
  on top of whichever policy is active rather than a policy of their own.
- A critical publish is a manual `EAS_UPDATE_CRITICAL=1 bun run eas update …` until #137 adds the
  `critical` workflow input; `rollout_percentage` does not exist until then either.
