# ADR-0002: release-please owns versioning and the release tag

- **Status:** Accepted
- **Date:** 2026-09-11
- **Issue:** #60 (D1 release mechanics; the grill outcome is the last comment on the issue)

## Context

The store rung of the ladder (PLAN.md decisions 3, 12) already existed: a `vX.Y.Z` tag → the
`production` GitHub Environment reviewer → the EAS `Release` workflow, which skips itself when the
native fingerprint already has a store build. What was missing was who bumps `version`, writes a
changelog and pushes the tag; until now that was a human editing `app.config.ts` and running
`git tag`. Build numbers were never in question (EAS, `appVersionSource: remote`, `autoIncrement`).
The forces: one PR per ticket squash-merged with a Conventional Commit title (so the history is
already machine-readable), Renovate PRs landing on `main` on their own, and a native fingerprint
that must not move on a JS-only release.

## Decision

release-please, in manifest mode with the standard `node` release type, owns the version:

1. **Version meaning.** `version` tracks every release-please release, OTA-only changes included.
   The existing fingerprint gate in `.eas/workflows/release.yml` turns a tag with an unchanged
   fingerprint into a green no-op store step.
2. **Two human steps per store release.** Merge the release PR (cuts version + changelog + tag),
   then approve the `production` GitHub Environment (spends money, submits). Neither is automated.
3. **Source of truth = `package.json`.** `app.config.ts` reads it. release-please touches only
   `package.json` and `CHANGELOG.md`. Nobody hand-edits `version`.
4. **Build numbers stay on EAS** (`appVersionSource: remote`, `autoIncrement` on production).
5. **Release triggers.** Defaults: `feat` → minor, `fix` / `perf` / `revert` → patch, `!` /
   `BREAKING CHANGE` → major; `chore` / `docs` / `ci` / `test` / `build` / `refactor` / `style`
   hidden and non-releasing (`changelog-sections` in `release-please-config.json` spells this out).
   Renovate uses `chore(deps)` for every update (`:semanticCommitTypeAll(chore)`), so dependency
   bumps never release on their own.
6. **Bootstrap.** `.release-please-manifest.json` seeded at `1.0.0`; `last-release-sha` set to the
   `main` head at merge time (`5ec4892b`) so earlier history is not released retroactively.
   `bun run init` resets the manifest and `package.json` to `1.0.0` and drops `last-release-sha`
   (`--fresh-git`) or points it at the generated project's current HEAD.
7. **Token.** `.github/workflows/release-please.yml` reads one `RELEASE_PLEASE_TOKEN` secret
   (contents + pull-requests write). A GitHub App is recommended, a fine-grained PAT is the quick
   path. `GITHUB_TOKEN` is not acceptable: its events do not trigger the required checks on the
   release PR or the tag-triggered `release.yml`. The secret is on the human setup checklist next
   to `EXPO_TOKEN`.
8. **Fingerprint finding (verified).** `@expo/fingerprint` hashes `version` by default: bumping it
   moved the production iOS hash `c7aa6066…` → `907d6e…`. `fingerprint.config.js` with
   `sourceSkips: SourceSkips.ExpoConfigVersions` makes the bump hash-neutral — `24e465debc…` before
   and after the same bump. Every fingerprint path (`bun run fingerprint`, the EAS `fingerprint`
   job, `eas build`, the expo-updates runtime version) loads that file through
   `normalizeOptionsAsync`.
9. **Staging deploy on the release commit runs as normal**, so the tagged commit always exists as
   a staging update group and the promoted group's reported version matches the tag.
10. **Delivery.** One PR: config + manifest + workflow, `fingerprint.config.js`, `app.config.ts`
    reading `package.json`, the Renovate commit type, the `autorelease: pending` /
    `autorelease: tagged` labels in `scripts/repo-settings.js`, the init-script reset with its
    drift-guard tests, docs and this record.

## Consequences

- Adding `fingerprint.config.js` changes the fingerprint once: the merge produces one round of
  staging builds. No store builds exist yet, so nothing else is invalidated. From then on a
  version bump is invisible to the fingerprint, and `release.yml`'s unchanged-fingerprint skip
  keeps working for OTA-only releases.
- The store version can skip numbers: every release-please release bumps `version`, but only the
  ones with a native change produce a store build, so TestFlight / Play may go 1.2.0 → 1.5.0.
  That is intended (decision 1) — the version names what is on `main`, not what was built.
- `RELEASE_PLEASE_TOKEN` is a new owner-owed secret; until it exists the workflow fails at its
  first step with a pointer to the checklist, and no release PR appears. The two labels need
  `bun run repo:settings:apply --only labels` once.
- Hand-edits to `version` and hand-pushed tags are now conventions violations
  ([Conventions → Commits and PR titles](../conventions.md#commits-and-pr-titles)); the
  `version_check` job in the EAS release still refuses a tag that does not match `package.json`.
- The Renovate change means a dependency bump that users should notice needs a `fix` / `feat`
  commit of its own to reach the changelog.
- `bun run init` gains a `versioning` step; the drift guard in `scripts/__tests__/init.test.ts`
  fails if the manifest, config or `package.json` `version` line move.
