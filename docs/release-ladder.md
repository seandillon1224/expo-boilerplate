# Release ladder

The runbook for everything that leaves a laptop: PR → `main` → **staging** → **UAT** →
**production** → **stores**, plus how to go back down ([Rollback](#rollback)) and how to get a fix
up quickly ([Hotfix](#hotfix)). The environment variables each rung reads and the owner-only
setup are in [Environments and secrets](environments-and-secrets.md); how testers get a build is
[Build sharing](build-sharing.md).

## The full path at a glance

| Rung                 | Trigger                                                   | What moves                                                                                                              | Gate                                                                                       | Section                                                                                     |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **PR**               | open / push a PR into `main`                              | JS gate (`ci.yml`), native Maestro check (`e2e.yml`), web preview to the `pr-<number>` alias, fingerprint-drift comment | Required checks + review ([JS gate](js-gate.md)); nothing on the ladder moves              | [PR previews](#pr-previews-web-automatic), [Drift](#fingerprint-drift-on-prs-informational) |
| **`main` → staging** | the squash-merge (push to `main`)                         | OTA to channel `staging` (+ staging builds on a fingerprint miss), web `staging` alias, Slack post                      | none — automatic                                                                           | [Staging](#staging-automatic)                                                               |
| **staging → UAT**    | `workflow:run promote.yml -F target=uat` (by hand)        | The chosen **staging update group** republished to `uat`, unchanged (+ uat builds on a miss), web `uat` alias, Slack    | `require-approval` on expo.dev; fingerprint gate                                           | [UAT and production](#uat-and-production-manual)                                            |
| **UAT → production** | `workflow:run promote.yml -F target=production` (by hand) | The **same** group republished to `production`, web production URL, Slack                                               | `require-approval` on expo.dev; fingerprint gate **refuses** a runtime with no store build | [UAT and production](#uat-and-production-manual)                                            |
| **Store release**    | push a `vX.Y.Z` tag (after a `version` bump PR)           | Production store builds → TestFlight internal group + Play internal track; skipped when the fingerprint is unchanged    | GitHub `production` Environment reviewer (`.github/workflows/release.yml`)                 | [Store release](#store-release-tag)                                                         |
| **Back down**        | by hand                                                   | An earlier group republished on the channel, or a roll-back-to-embedded; web alias re-pointed                           | same gates as going up when done through `promote.yml`; none from the CLI                  | [Rollback](#rollback)                                                                       |

Two rules hold everywhere on the ladder: **what UAT signed off is byte-for-byte what production
gets** (PLAN.md decision 3 — promotions republish a group, they never re-bundle), and **an update
only reaches builds with the same native fingerprint** (`runtimeVersion` = fingerprint, PLAN.md
decisions 2 and 13 — a native change needs new builds before the OTA lane can carry it).

## Channel, branch, variant and profile mapping

Derived from `app.config.ts` (`APP_VARIANT`), `eas.json`, `.eas/workflows/*.yml` and
`scripts/repo-settings.js`; the variables each EAS environment holds are in
[Environments and secrets → Environment mapping](environments-and-secrets.md#environment-mapping).

| `APP_VARIANT` | `eas.json` profile(s)                                                    | EAS environment | Update channel → branch     | Fed from                                                          | GitHub Environment                                                      | EAS Hosting alias                                | Workflow(s)                                       |
| ------------- | ------------------------------------------------------------------------ | --------------- | --------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `development` | `development`, `development-simulator`, `e2e-ios-sim`, `e2e-android-apk` | `development`   | – (embedded bundle only)    | the PR branch                                                     | –                                                                       | `pr-<number>` (preview deployment, never `prod`) | `e2e.yml`, `preview-web.yml`                      |
| `staging`     | `staging` (`internal`, Android APK)                                      | `preview`       | `staging` → `staging`       | every push to `main`, `eas update --channel staging`              | –                                                                       | `staging`                                        | `deploy-staging.yml`                              |
| `uat`         | `uat` (`internal`, Android APK)                                          | `preview`       | `uat` → `uat`               | a staging group, `eas update:republish --destination-channel uat` | `uat` (created; no Actions job targets it yet)                          | `uat`                                            | `promote.yml -F target=uat`                       |
| `production`  | `production` (`store`, `autoIncrement`)                                  | `production`    | `production` → `production` | the same staging group, `--destination-channel production`        | `production` (required reviewer; gates `.github/workflows/release.yml`) | production URL of the dev-domain (`prod: true`)  | `promote.yml -F target=production`, `release.yml` |

Notes:

- Channel and branch names are equal by construction (`eas channel:create <name>` linked each to a
  branch of the same name); `bun run eas channel:list` shows the live mapping. Nothing on the
  ladder runs `eas channel:edit` — re-pointing a channel at another branch is a global switch for
  every installed build on it and is not a rollback tool here (see [Rollback](#rollback)).
- `staging` and `uat` share the `preview` EAS environment; the profile's `env.APP_VARIANT` is what
  tells them apart, which is why every non-build workflow job sets `environment:` **and**
  `APP_VARIANT` explicitly.
- Two approval mechanisms, one per runner: EAS workflow runs (`promote.yml`) pause on a
  `require-approval` job on expo.dev; GitHub Actions jobs that declare `environment: production`
  (`release.yml`) wait for the GitHub reviewer. Neither applies to the other side.
- Git has one long-lived branch, `main`. `uat` / `production` are EAS Update branches, not git
  branches; a promotion is a server-side republish and touches no commit. Store builds are keyed
  to `vX.Y.Z` tags on `main`.

## PR previews (web, automatic)

**Workflow:** `.eas/workflows/preview-web.yml` (`Preview web`). **Trigger:** every PR into `main`
(opened / reopened / synchronize — the same trigger as `e2e.yml`; fork PRs never trigger EAS
workflows), plus `workflow_dispatch`:

```sh
bun run eas workflow:run .eas/workflows/preview-web.yml -F hosting=enabled   # alias `pr-manual`
bun run eas workflow:validate .eas/workflows/preview-web.yml                 # after editing (cap: 16 KiB)
```

```text
deploy_web (HOSTING enabled) ── comment
```

| Job          | Type             | What it does                                                                                                                                                                                                                               | Outputs used downstream                                             |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `deploy_web` | `deploy`         | Exports web itself (`environment: development`, `APP_VARIANT=development` — the PR is the development variant, as in `e2e.yml` and the JS gate) and deploys it as a preview to the `pr-<number>` alias. Skipped until `HOSTING` is enabled | `deploy_alias_url`, `deploy_deployment_url`, `deploy_dashboard_url` |
| `comment`    | `github-comment` | `after: [deploy_web]`, so it posts on a failed deploy too; skipped with the deploy (no "skipped" noise on PRs) and on dispatch runs (no PR). Custom markdown: alias URL, per-commit URL, dashboard, run link                               | –                                                                   |

**Two URLs per PR.** `https://<dev-domain>--pr-<number>.expo.app` is the **alias**: aliases are
unique per project and re-assigned on every deploy, so the link a reviewer bookmarked always shows
the newest push. `https://<dev-domain>--<id>.expo.app` is the **deployment**: immutable, unique
per commit, useful to compare two pushes side by side. Every push adds a new comment (the
`github-comment` job has no update-in-place), exactly like the native E2E comment. Nothing on the
ladder moves: `staging` / `uat` / production aliases only change from `main` (below). Closed PRs
leave their `pr-<number>` alias behind pointing at the last deployment; EAS Hosting has no alias
delete, and a stale alias costs nothing — reuse of the number is impossible, so nothing ever
collides.

**Repo constant.** The same `HOSTING` constant as `deploy-staging.yml` (`|| 'disabled'` on
`deploy_web.if` + the `workflow_dispatch` input default): enable it in **both** files in the same
PR, once the owner has claimed the dev-domain by hand (table under Staging → Repo constants).

## Fingerprint drift on PRs (informational)

**Workflow:** `.github/workflows/ci.yml` → `Fingerprint drift` job (GitHub Actions, not EAS: the
repo-pinned `@expo/fingerprint` runs in a few seconds, needs no Metro, no EAS credits and no
`EXPO_TOKEN`). **Trigger:** every PR into `main` (PR-only — a push to `main` has no base to
compare against). It computes the **production**-variant hash (`APP_VARIANT=production`, the
profile `release.yml` and the `promote.yml` production gate key on) for the PR base and for the
merge commit, with a fresh `bun install` on the base because autolinked native modules are
fingerprint sources.

| Outcome                             | Comment                                                                                                                                                                                                     | Label               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Hashes equal, no earlier drift      | none — a clean PR collects no noise                                                                                                                                                                         | –                   |
| iOS and/or Android hash differs     | **one** comment, upserted by the `<!-- fingerprint-drift -->` marker (updated in place on every push): which platforms changed, base vs PR hashes, what merging implies (below), how to inspect the sources | `fingerprint-drift` |
| A later push brings the hashes back | the same comment flips to **✅ resolved**                                                                                                                                                                   | removed             |

The job is **never red on drift** and is **not** in `REQUIRED_CHECKS` ([JS gate](js-gate.md)):
a native change is legitimate, the point is that nobody merges one without knowing the
consequences. Those consequences are the rest of this page:

- **Merge → new staging builds.** `deploy-staging.yml` misses its build cache on the new hash and
  cuts fresh staging builds (paid; iOS only with `IOS_BUILDS`); installed staging apps must be
  reinstalled because the OTA cannot reach them ([Reinstall-required rule](#staging-automatic)).
- **Promotion to production is refused** until a store build carries the new hash
  ([Fingerprint gate](#uat-and-production-manual), PLAN.md decision 13).
- **A store release is required:** bump `version` in `app.config.ts`, push `vX.Y.Z` →
  `.github/workflows/release.yml` → `.eas/workflows/release.yml` ([Store release](#store-release-tag)),
  then promote the staging group again.

Drift you did not intend (a dependency bump that pulled a native module, a `package.json` `scripts`
edit, a changed icon) shows up the same way; `APP_VARIANT=production bun run fingerprint --debug`
on both branches lists every source that fed the hash ([environments and
secrets](environments-and-secrets.md#runtime-version--native-fingerprint)). The comparison is
relative, so build-time env such as `SENTRY_ORG` (unset in Actions, set on EAS) does not matter:
both sides are computed the same way. Fork PRs get a read-only token, so there the verdict lands
only in the job summary. The `fingerprint-drift` label was created by hand (`gh label create`);
#55 folds it into the repo-settings script.

## Staging (automatic)

**Workflow:** `.eas/workflows/deploy-staging.yml` (`Deploy staging`). **Trigger:** every push to
`main` (a squash-merge), plus `workflow_dispatch`:

```sh
bun run eas workflow:run .eas/workflows/deploy-staging.yml            # repo constants
bun run eas workflow:run .eas/workflows/deploy-staging.yml -F hosting=enabled -F ios_builds=enabled
bun run eas workflow:validate .eas/workflows/deploy-staging.yml       # after editing (cap: 16 KiB)
```

```text
fingerprint ─┬─ get_build_ios ─────── build_ios      (miss + IOS_BUILDS enabled: paid build)
             └─ get_build_android ─── build_android  (miss: paid build)
                        └──────────────── update  ── deploy_web (HOSTING enabled)
                                                          └───── slack (SLACK_WEBHOOK_URL set)
```

| Job             | Type          | What it does                                                                                                                                                                                                                                  | Outputs used downstream                                   |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `fingerprint`   | `fingerprint` | `environment: preview`, `env.APP_VARIANT=staging` — must equal the `staging` build profile, or nothing matches                                                                                                                                | `ios_fingerprint_hash`, `android_fingerprint_hash`        |
| `get_build_<p>` | `get-build`   | Newest finished `staging` / `internal` build with this fingerprint; `wait_for_in_progress` so two runs on a new fingerprint share one build                                                                                                   | `build_id` (empty on a miss)                              |
| `build_<p>`     | `build`       | Only on a miss: a fresh internal-distribution staging build (install page + QR). iOS additionally needs `IOS_BUILDS` enabled                                                                                                                  | `build_id`                                                |
| `update`        | `update`      | `after:` the four build jobs (a failed build never blocks the OTA); `eas update --channel staging --environment preview`, message = commit message; Sentry source maps uploaded from the same export, best-effort until the Sentry vars exist | `first_update_group_id`, `updates_json`                   |
| `deploy_web`    | `deploy`      | `needs: [update]`; exports web itself and deploys to EAS Hosting as a preview promoted to the `staging` alias. Skipped until `HOSTING` is enabled                                                                                             | `deploy_url`, `deploy_alias_url`, `deploy_deployment_url` |
| `slack`         | custom steps  | `after:` everything, so it posts on red runs too; composes the summary from `after.<job>` and `POST`s it with Node `fetch`. Exits 0 with a log line while `SLACK_WEBHOOK_URL` is unset                                                        | –                                                         |

**Reinstall-required rule.** `runtimeVersion` is the native fingerprint, so an update only reaches
builds with the same hash. A JS-only merge hits the cache: no build, installed staging apps pick the
update up on next launch. A merge that changes the native surface (config plugin, native dependency,
`app.config.ts` identifiers, `eas.json`, `package.json` scripts) misses: `build_<p>` cuts new
builds, the update lands on the new hash only, and the Slack post is flagged
**⚠️ Reinstall required** — testers install from the build page links (QR on the page; iOS needs the
device registered, [device onboarding](device-onboarding.md)). The old builds keep the last update
they had. `build_ios` failing (no ad hoc credentials yet) or being disabled does not stop the
Android build, the update or the web deploy; the post says so per platform.

**Where things land.**

- Builds: expo.dev → project → Builds (the install page is the build page; the Slack post links it).
- Update: channel `staging` → branch `staging`.
  `bun run eas update:list --branch staging --limit 1 --json` shows the group that is live;
  `bun run eas update:view <group-id>` the platforms in it. `promote.yml` promotes that group id — it is also
  the `update` job's `first_update_group_id` output (see the run page → job outputs) and is quoted in
  the Slack post.
- Web: the `staging` alias of the project's EAS Hosting dev-domain
  (`https://<dev-domain>--staging.expo.app`); expo.dev → project → Hosting for the deployment list.
- Sentry: source maps for the update's bundle, once the Sentry variables are set (below).

**Re-running.** Runs are never queued: a new push to `main` cancels the run in flight
(`concurrency.cancel_in_progress: true`) so staging always ends on the newest commit; at worst one
partial build is wasted and the next run cuts it again. To republish the current `main` by hand use
the `workflow:run` above (its update message is `manual staging publish of <sha>`), or re-run the
failed run from the run page. A build that failed on credentials is not cached, so the next run
retries it.

**Repo constants (flip in one PR: the `|| '<literal>'` on the job `if` and the matching
`workflow_dispatch` input default).**

| Constant     | Default    | Job          | Enable when                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOS_BUILDS` | `disabled` | `build_ios`  | The iOS ad hoc credentials for `staging` exist ([iOS runbook](environments-and-secrets.md#ios-runbook-owner), steps 1–3). Until then every iOS build fails at `Credentials are not set up`.                                                                                                                                                                                                                                                                                       |
| `HOSTING`    | `disabled` | `deploy_web` | The owner has made the project's first deployment by hand — it claims the dev-domain and is interactive: `bun run export:web && bun run eas deploy --environment preview --export-dir dist-web --dev-domain expo-boilerplate --alias staging`. Prove the export is deployable without spending anything with `--dry-run` (writes `deploy.tar.gz`, gitignored). Flip it here and in `preview-web.yml` (PR previews, above) together. `bun run init` (T7.1) renames the dev-domain. |

Slack has no constant: create the incoming webhook ([Build sharing → Slack channel](build-sharing.md#slack-channel)) and store it as
`SLACK_WEBHOOK_URL` on EAS (`secret`, `preview` environment — the job reads it from there, never
from GitHub); the next run posts. All three prerequisites and the Expo GitHub App link (required for
the `push` trigger) are on the
[human setup checklist](environments-and-secrets.md#human-setup-checklist-owner).

**Sentry.** The `update` job uploads source maps itself (`upload_sentry_sourcemaps`, unset =
try, do not fail); `bun run sentry:sourcemaps` is the local twin. Once `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG` and `SENTRY_PROJECT` are set on EAS, set `upload_sentry_sourcemaps: true` in the
workflow so a broken upload fails the run rather than shipping unsymbolicated errors.

## UAT and production (manual)

**Workflow:** `.eas/workflows/promote.yml` (`Promote`). **Trigger:** `workflow_dispatch` only —
never on push. It promotes a **staging update group** (PLAN.md decision 3): the exact assets
already served on `staging` are republished, unchanged, to the target channel. Nothing is
re-bundled, so what UAT signed off is byte-for-byte what production gets.

```sh
bun run eas workflow:run .eas/workflows/promote.yml -F target=uat                          # newest staging group
bun run eas workflow:run .eas/workflows/promote.yml -F target=production -F update_group_id=<id>
bun run eas workflow:run .eas/workflows/promote.yml --ref <commit> -F target=uat -F ios_builds=enabled -F hosting=enabled
bun run eas workflow:validate .eas/workflows/promote.yml                                    # after editing (cap: 16 KiB)
```

| Input             | Values                  | Default          | Meaning                                                                                                                                                           |
| ----------------- | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`          | `uat` \| `production`   | `uat` (required) | Channel to promote to.                                                                                                                                            |
| `update_group_id` | group id                | empty            | Which staging group. Empty = newest on the `staging` branch (`bun run eas update:list --branch staging --limit 1 --json`). Any group not on `staging` is refused. |
| `web`             | `promote` \| `skip`     | `promote`        | Whether to move the web alias too (still needs `HOSTING`).                                                                                                        |
| `ios_builds`      | `enabled` \| `disabled` | `disabled`       | `IOS_BUILDS` repo constant (as in `deploy-staging.yml`): cut an iOS uat build on a miss. Needs the `uat` ad hoc credentials.                                      |
| `hosting`         | `enabled` \| `disabled` | `disabled`       | `HOSTING` repo constant: the dev-domain has been claimed by hand.                                                                                                 |

`--ref <commit>` runs the workflow from a git ref instead of uploading the working directory; use
the group's commit (printed by `resolve`, and `gitCommitHash` in `bun run eas update:view <id> --json`)
whenever a uat build or a web redeploy may be cut, so they come from the same source as the update.

```text
resolve ── approve ─┬─ fingerprint_<target> ──┐
                    ├─ get_build_ios ─────────┼─ gate ─┬─ build_ios (uat miss, IOS_BUILDS)
                    └─ get_build_android ─────┘        ├─ build_android (uat miss)
                                                       └───── republish ── promote_web_<target> (HOSTING, web=promote)
                                                                              └───── slack
```

| Job                    | Type               | What it does                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve`              | custom steps       | Picks the group (input or newest on `staging`), refuses one that is not on the `staging` branch, and exports `group_id`, per-platform `ios_runtime` / `android_runtime`, `commit`, `message`. Runs **before** the approval so the approver can read what they are approving.                            |
| `approve`              | `require-approval` | The gate. The run pauses on expo.dev (run page → Approve / Reject); any account member with access to the project can decide. Reject fails the job and, through `needs`, every job below it; nothing has been built or published yet.                                                                   |
| `fingerprint_<target>` | `fingerprint`      | The checkout's native fingerprint for the target variant (`preview` + `APP_VARIANT=uat`, or `production` + `APP_VARIANT=production` — must equal the `eas.json` profile).                                                                                                                               |
| `get_build_<p>`        | `get-build`        | Newest finished build of the **target** profile whose fingerprint equals the **group's** runtime version — "can an installed uat / production build run these bytes?". `store` distribution for production, `internal` for uat. Skipped for a platform the group was not published for.                 |
| `gate`                 | custom steps       | The matrix below, per platform; exits 1 with the reason on a refusal. Outputs `build_ios` / `build_android`.                                                                                                                                                                                            |
| `build_<p>`            | `build`            | uat only, on a miss: an internal-distribution `uat` build from this checkout (install page + QR). iOS also needs `IOS_BUILDS`.                                                                                                                                                                          |
| `republish`            | custom steps       | `eas update:republish --group <id> --destination-channel <target> --non-interactive`; `after:` the builds, so a failed uat build never blocks the OTA (it is keyed by runtime and harmless for a platform without a matching build). Message: `promote <id8> (staging → <target>): <original message>`. |
| `promote_web_<target>` | `deploy`           | Exports web from this checkout and deploys it to the `uat` alias / to production (`prod: true`). See _Web_ below.                                                                                                                                                                                       |
| `slack`                | custom steps       | Same job as staging: verdict, group ids, install links, "reinstall required" when uat builds were cut. Exits 0 while `SLACK_WEBHOOK_URL` is unset.                                                                                                                                                      |

**Fingerprint gate** (PLAN.md decision 13). `runtimeVersion` is the fingerprint, so an update
only ever runs on a build with the same hash. Per platform in the group:

| Target       | Target build for the group's runtime exists (`get_build` hit) | No such build (miss)                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uat`        | Republish; installed uat apps update on next launch.          | Checkout fingerprint **==** group runtime → `build_<p>` cuts a uat build, then republish; Slack says **⚠️ Reinstall required**. Checkout fingerprint **!=** group runtime → refused: re-run with `--ref <group commit>` (a build from here could not run the group). |
| `production` | Republish; installed production apps update on next launch.   | **Refused.** Production is never built at promotion time: tag a release and run `release.yml` (T5.3) so the store build carries the new fingerprint, then promote again — the store build's fingerprint will then match.                                             |

The gate compares the group's runtime with the target's builds, not with staging's: a group that
ran fine on staging can still be refused for production when no production build has that
fingerprint yet (a native change merged since the last release). `get_build` waits for an
in-progress build of the same fingerprint, so a release build that is still running counts.

**Same update group.** A promotion creates a new group on the target branch (the republish),
with the same assets, manifest and runtime version as the source; the Slack post and the
`republish` job's `group_id` output name it, and `bun run eas update:view <new-id>` shows
`isRollBackToEmbedded: false` and the original commit hash. Promote the same staging group to
`uat` and later to `production` — never a group that only exists on `uat`. Going back is the same
mechanism in reverse: promote an **earlier** staging group ([Rollback](#rollback)).

**Web.** The `deploy` job always exports fresh (EAS Hosting has no "move the alias" job, and the
CLI has no non-interactive way to list deployments to find the staging one), so `promote_web_*`
redeploys this checkout to the `uat` alias or to production; run with `--ref <group commit>` for
a byte-identical export. To move an existing deployment instead:
`bun run eas deploy:alias --alias uat --id <deployment-id>` (id: expo.dev → Hosting, or the
`deploy_identifier` output of the staging run) and `--prod` for production. Both need `HOSTING`.

**Where things land.** Update: channel `uat` → branch `uat`, or `production` → `production`
(the republish links or creates the branch). Builds: uat builds on the build page; production
builds only ever come from `release.yml`. Web: `https://<dev-domain>--uat.expo.app`, or the
production URL of the dev-domain.

**Approval gates, side by side.** `promote.yml` runs on EAS, so its human gate is the
`require-approval` job on expo.dev. GitHub Environments `uat` and `production` (required
reviewer: the repo owner; deployments only from protected branches; created by
`bun run repo:settings:apply` from `scripts/repo-settings.js`) gate the **GitHub Actions** side
of the same ladder: a job that declares `environment: production` — `release.yml` (T5.3) and any
later Actions-side promotion step — waits for a reviewer before it runs. They do not apply to EAS
workflow runs; they are created now so both halves of the ladder carry the same named rungs.

## Store release (tag)

**Workflows:** two files, one gate. `.github/workflows/release.yml` (`Release`, GitHub Actions) runs
on `push` of a `v*` tag; its single `trigger` job declares `environment: production`, so it waits
for the required reviewer (`scripts/repo-settings.js`) and then runs
`bun run eas workflow:run .eas/workflows/release.yml -F tag=<tag>` with `EXPO_TOKEN` (fails early
with a readable error when the secret is missing). `.eas/workflows/release.yml` (`Release`, EAS)
is `workflow_dispatch`-only: EAS does support `on: push: tags:`, but a tag trigger there would
bypass the GitHub reviewer, which is the whole point of the split. Production RCs land in the
**TestFlight internal group** and the **Play internal track** (PLAN.md decision 12); nothing here
touches App Store review or Play production.

**Cutting a release** (by hand until D1, #60 — no release-please, no changelog yet):

1. Bump `version` in `app.config.ts` in a PR (`chore(release): 1.2.3`), merge it.
   `appVersionSource: remote` means EAS owns `buildNumber` / `versionCode` and auto-increments them;
   `version` is yours.
2. Tag the merge commit and push the tag (tags are not protected; the queue never pushes one):
   `git fetch origin && git tag v1.2.3 origin/main && git push origin v1.2.3`.
3. Approve the `production` environment on the GitHub run (Actions → Release → Review deployments).
4. Follow the EAS run (expo.dev → project → Workflows, or the Slack post). Manual equivalent:

```sh
bun run eas workflow:run .eas/workflows/release.yml -F tag=v1.2.3                 # repo constants
bun run eas workflow:run .eas/workflows/release.yml -F tag=v1.2.3 -F force=yes -F platforms=android
bun run eas workflow:validate .eas/workflows/release.yml                          # after editing (cap: 16 KiB)
```

| Input         | Values                       | Default    | Meaning                                                                              |
| ------------- | ---------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `tag`         | `vX.Y.Z`                     | (required) | Must equal `v` + `app.config.ts` `version`; anything else fails `version_check`.     |
| `platforms`   | `both` \| `ios` \| `android` | `both`     | Platforms to release.                                                                |
| `force`       | `no` \| `yes`                | `no`       | `yes` = build + submit even when a store build with this fingerprint already exists. |
| `ios_release` | `enabled` \| `disabled`      | `disabled` | `IOS_RELEASE` repo constant (below).                                                 |
| `play_submit` | `enabled` \| `disabled`      | `disabled` | `PLAY_SUBMIT` repo constant (below).                                                 |

```text
version_check ── fingerprint ─┬─ check_ios ─────┐
                              └─ check_android ─┴─ gate ─┬─ build_ios (IOS_RELEASE) ── submit_ios (TestFlight)
                                                         └─ build_android ─────────── submit_android (PLAY_SUBMIT)
                                                                                          └───── notify (Slack)
```

| Job             | Type          | What it does                                                                                                                                                                                                                                     |
| --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `version_check` | custom steps  | Refuses a tag that is not `vX.Y.Z` or does not equal `v` + `expo config` `version` (`APP_VARIANT=production`), with the fix printed (bump + retag, or delete the tag). Outputs `version`.                                                        |
| `fingerprint`   | `fingerprint` | `environment: production`, `APP_VARIANT=production` — must equal the `production` build profile.                                                                                                                                                 |
| `check_<p>`     | `get-build`   | Newest finished **store** build of the `production` profile with this fingerprint (`wait_for_in_progress`, so a release already building counts). Skipped for an unselected platform.                                                            |
| `gate`          | custom steps  | Per selected platform: hit + `force=no` → **skip** with `fingerprint unchanged since last store build <id>; nothing to release — bump native deps or use force=yes`, **exit 0** (the run stays green); miss or `force=yes` → `release_<p>=true`. |
| `build_<p>`     | `build`       | `production` profile (`distribution: store`, `channel: production`, `autoIncrement`). Message `release <tag> (<version>)`. iOS also needs `IOS_RELEASE`.                                                                                         |
| `submit_<p>`    | `submit`      | `submit.production` in `eas.json`: iOS upload with no App Store release = TestFlight, internal group (automatic distribution); Android `track: internal`. Android needs `PLAY_SUBMIT`.                                                           |
| `notify`        | custom steps  | Same Slack job as staging: verdict, build links, where each platform landed (TestFlight internal group / Play internal track), run URL. Exits 0 while `SLACK_WEBHOOK_URL` is unset (`production` environment).                                   |

**Unchanged-fingerprint rule.** A store build is only worth cutting when the native surface
changed: the OTA lane already carries every JS-only change to installed production apps
(`promote.yml`). So a tag whose fingerprint already has a store build (per platform) is a **skip**,
not a failure — the run is green, the Slack post says `⏭️ skipped`, and nothing is built or
submitted. To ship a store build anyway (store listing changes, a re-submit, a rejected binary),
re-run with `force=yes`. This is the mirror of the production promotion rule: `promote.yml`
refuses a group whose fingerprint has no store build; `release.yml` is how that build comes to
exist. After a release with a new fingerprint, promote the staging group again — it now hits.

**Where things land.** iOS: App Store Connect → TestFlight → the build appears under the internal
group(s) with automatic distribution (`groups:` on the `submit` job, or the `testflight` job, can
target named groups later). Android: Play Console → Testing → Internal testing. Neither is a store
release; promotion to review / production tracks stays manual in the consoles for now (D1).
Builds: expo.dev → project → Builds, message `release <tag> (<version>)`.

**Repo constants (flip in one PR: the `|| '<literal>'` on the job `if` and the matching
`workflow_dispatch` input default).**

| Constant      | Default    | Job              | Enable when                                                                                                                                                                                                                       |
| ------------- | ---------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOS_RELEASE` | `disabled` | `build_ios`      | App Store credentials for `production` and the App Store Connect API key are on EAS and `ascAppId` is in `submit.production.ios` ([iOS runbook](environments-and-secrets.md#ios-runbook-owner), steps 4–5). `submit_ios` follows. |
| `PLAY_SUBMIT` | `disabled` | `submit_android` | The first AAB was uploaded to Play by hand and the service-account key is on EAS ([Google Play runbook](environments-and-secrets.md#google-play-runbook-owner)). Android builds run either way.                                   |

Also owed: `EXPO_TOKEN` as a GitHub repository secret (the trigger job fails early without it) and
the GitHub `production` environment (`bun run repo:settings:apply`). All on the
[human setup checklist](environments-and-secrets.md#human-setup-checklist-owner).

## Rollback

An OTA rollback is **never an undo**: it is one more update group published on the branch, whose
bytes happen to be an earlier group's (or the binary's embedded bundle). Installed apps pick it up
exactly like any other update — with the current `manual` policy (`useUpdatePolicy`,
`checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`) that means **up to two cold launches**:
one to download it in the background, the next to run it. The bad group stays in the branch history
and can be inspected (`bun run eas update:view <id> --insights`); nothing is deleted.

### Which tool

| Situation                                                                            | Tool                                                                                                | Notes                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "The newest group on the branch is bad, the one before it was fine"                  | `bun run eas update:rollback <bad-group-id>`                                                        | One step: republishes the group published **before** the given one (same branch, same runtime). The id must be the branch's latest for that runtime — the CLI refuses otherwise. If there is no earlier group it rolls back to embedded instead.       |
| "I know which group was good" (two or more back, or a different runtime is involved) | `bun run eas update:republish --group <good-group-id> [--destination-channel <channel>]`            | Republishes a specific group. Without `--destination-*` it lands on the group's own branch (a same-channel rollback); with `--destination-channel` it is a cross-channel promotion — what `promote.yml` runs.                                          |
| "Every OTA on this runtime is suspect; run what the binary shipped with"             | `bun run eas update:roll-back-to-embedded --channel <channel> --runtime-version <fingerprint>`      | Publishes a _roll-back-to-embedded_ directive. Installed builds go back to the bundle compiled into them — for production that is the JS of the **store build**, possibly weeks old. Last resort, and the fix must be a new update or a store release. |
| "Only iOS (or only Android) is broken"                                               | any of the above with `-p ios` / `-p android`                                                       | Every command takes `--platform`; the other platform keeps its current update.                                                                                                                                                                         |
| Web is broken                                                                        | `bun run eas deploy:alias --alias <alias> --id <deployment-id>` (`--prod --id <id>` for production) | Hosting deployments are immutable; a rollback re-points the alias at an earlier one. Ids: expo.dev → project → Hosting, or the `deploy_deployment_url` output of the run that made it.                                                                 |

`eas channel:edit --branch <other>` is deliberately **not** in the table: it re-points the channel
for every installed build and would break the "channel = branch of the same name" invariant that
`promote.yml` and every command above assume. All commands accept `--message` (use it: the message
is what `update:list` and the Slack post show) and `--non-interactive` / `--json` for scripts;
`update:republish --non-interactive` requires `--group` as the selector.

### Staging

No gate: the `slack` job is the only audience, and the next merge to `main` will overwrite whatever
you publish anyway.

```sh
bun run eas update:list --branch staging --limit 5                       # find the last good group
bun run eas update:rollback <bad-group-id> --message "rollback: <why>"    # one back, or:
bun run eas update:republish --group <good-group-id> --message "rollback: <why>"
bun run eas deploy:alias --alias staging --id <deployment-id>             # web, if it moved too
```

Alternatively republish `main` from a known-good commit — `bun run eas workflow:run
.eas/workflows/deploy-staging.yml --ref <sha>` — but that re-bundles (a fresh export, not the old
bytes) and cuts builds if the fingerprint differs; prefer the republish. Post in the Slack channel
by hand (template below): CLI rollbacks post nothing.

### UAT and production

The sanctioned path is `promote.yml` with an **earlier staging group**: `resolve` accepts any group
that lives on the `staging` branch, so a rollback is just a promotion of the group you were on
before. It goes through the same `require-approval` job and fingerprint gate (the earlier group's
runtime has a matching uat / store build — it had one when it was first promoted; if that build
was deleted the gate says so), redeploys the web alias when run with `--ref <group commit>`, and
posts to Slack.

```sh
bun run eas update:list --branch production --limit 5 --json    # what production has run, newest first
bun run eas update:view <current-production-group> --json       # → gitCommitHash + message identify the staging group it came from
bun run eas update:list --branch staging --limit 10             # pick the good staging group (same message / commit as the last good production group)

bun run eas workflow:run .eas/workflows/promote.yml --ref <good-group-commit> -F target=production -F update_group_id=<good-staging-group-id>
bun run eas workflow:run .eas/workflows/promote.yml --ref <good-group-commit> -F target=uat        -F update_group_id=<good-staging-group-id>
```

Then approve on expo.dev (run page → Approve). The republished message reads
`promote <id8> (staging → production): <original message>`; reply in the Slack thread that this
run is a **rollback** and why, because the post looks like any other promotion.

**Emergency path (CLI, no approval).** When minutes matter and a project member is at a keyboard,
the two one-liners below do the same republish without the workflow. They bypass the expo.dev
approval and the fingerprint gate — safe for `update:rollback` (the previous group already ran on
this channel) and for republishing a group that was on the channel before; **not** for a group
that was never on the channel. Post to Slack by hand afterwards and say it was done from the CLI.

```sh
bun run eas update:rollback <bad-production-group-id> --message "rollback: <why>"
bun run eas update:republish --group <earlier-production-group-id> --message "rollback: <why>"   # same branch
bun run eas deploy:alias --prod --id <deployment-id>                                              # web, if needed
```

The `uat` channel is the same with `uat` ids and `--alias uat`. Rolling production back does
**not** roll staging or UAT back — each channel is its own branch; decide per rung.

### Store builds

A binary cannot be un-shipped. What you can do, per store, and the OTA lane still covers JS:

- **TestFlight (internal group):** App Store Connect → TestFlight → the build → **Expire** stops
  new installs; testers who already have it keep it. Nothing here reaches the App Store until a
  human promotes the build in App Store Connect, so an internal-group RC is never a user-facing
  incident.
- **Play internal track:** Play Console → Testing → Internal testing → **Halt rollout** or create a
  new release with the previous AAB. Same scope: internal testers only until a human promotes.
- **Already in production on a store:** users on the bad binary are still on the `production`
  channel, so a JS-caused regression is fixed by an OTA rollback above (or a hotfix update). A
  native regression needs a **fix release**: bump `version`, merge, tag `vX.Y.Z+1` ([Store
  release](#store-release-tag)). The gate skips a tag whose fingerprint already has a store build —
  if the fix did not change the native surface, it was OTA-able; if you need a store build anyway
  (store-side rejection, listing changes) re-run with `-F force=yes`.
- `roll-back-to-embedded` on `production` puts users on the JS the **store build** embedded; on a
  brand-new store build that is the tagged commit's JS, on an old one it may predate weeks of
  promotions. Check `bun run eas build:view <build-id>` (git commit) before using it.

### Verify the rollback landed

1. **Server:** the newest group on the branch is the rollback, with the expected runtime:

   ```sh
   bun run eas channel:view production            # channel → branch, newest groups
   bun run eas update:list --branch production --limit 3
   bun run eas update:view <new-group-id> --json  # runtimeVersion == the good group's; isRollBackToEmbedded true only for roll-back-to-embedded
   ```

   Every rollback creates a **new** group id; `update:list` must show it above the bad one.

2. **Device:** on an installed build of that channel, Settings → **Updates** (`updates-screen`):
   press **Check for update** (`updates-check`) → **Apply** (`updates-apply`), or cold-launch
   twice. `Update ID` (`updates-row-updateId`) must equal one of the platform update ids inside
   the new group (`update:view` lists them), `Source` (`updates-row-source`) reads _OTA_ — or
   _Embedded_ after a roll-back-to-embedded — and `Runtime version` is unchanged. A build that
   still shows the bad id after two cold launches is on a different runtime or channel: check
   `updates-row-channel` / `updates-row-runtimeVersion` against the group.
3. **Fleet:** `bun run eas update:view <new-group-id> --insights` (launches, unique users, crash
   rate) shows adoption climbing over the next hours; the bad group's launches must trend to zero.
   Sentry: the regression's issue stops receiving events tagged with the bad update id.
4. **Web:** open the alias URL; the per-deployment URL it now serves is the earlier deployment
   (expo.dev → Hosting → the alias row).

### What to tell Slack

The workflow posts for a `promote.yml` rollback; for CLI rollbacks post this yourself in the same
channel (`#releases` or whatever the webhook targets), one message per channel touched:

```text
⏪ Rollback · production · <bad-group-id8> → <good-group-id8> (<good original message>)
Why: <one line — symptom, who reported it, link to the Sentry issue / bug>
How: eas update:rollback from the CLI (no approval) | promote.yml run <link>
Reach: installed production apps pick it up on the next launch (up to two cold launches); web alias re-pointed / unchanged
Next: <hotfix PR link, or "staging is unaffected, fix ships via the normal ladder">
```

## Hotfix

There is no hotfix branch: trunk-based (PLAN.md decision 3) means a fix is a PR like any other, and
the ladder is fast enough that skipping rungs is never worth the loss of "what UAT signed off is
what production gets".

1. **Stop the bleeding first** with a [Rollback](#rollback) if users are affected; a rollback takes
   minutes, a fix takes at least one CI run.
2. Branch off `main`, fix, open the PR (`fix: …`), let the JS gate and the native E2E check run,
   squash-merge. If the PR carries the `fingerprint-drift` label the fix is native: it also needs a
   store release before it can reach production (step 4b).
3. The merge publishes to `staging` automatically; check the Slack post and the staging app.
4. Promote:
   - **JS-only:** `bun run eas workflow:run .eas/workflows/promote.yml -F target=production
-F update_group_id=<the fix's staging group>` (via `uat` first if the change is not trivial),
     approve on expo.dev. Because the fix group is the newest on `staging`, the id can be omitted.
   - **Native:** bump `version` in the same or a follow-up PR, tag `vX.Y.Z`, approve the
     `production` Environment, wait for `release.yml` to cut the store build, then promote the
     staging group — the fingerprint gate now hits. Until users install the new binary they are on
     the rolled-back OTA from step 1.
5. Verify as above; close the loop in the Slack thread that announced the rollback.

Never publish a fix straight to `production` with `eas update --channel production` from a laptop:
it would bypass staging, the approval, the fingerprint gate and Sentry source maps, and would
create a production group with no staging twin — which the next `promote.yml` run cannot see.
