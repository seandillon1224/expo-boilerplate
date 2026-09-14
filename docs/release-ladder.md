# Release ladder

The runbook for everything that leaves a laptop: PR → `main` → **staging** → **UAT** →
**production** → **stores**, plus how to go back down ([Rollback](#rollback)), how to get a fix
up quickly ([Hotfix](#hotfix)) and how to reach users still on an older store binary
([Backports](#backports-older-runtimes)). The environment variables each rung reads and the owner-only
setup are in [Environments and secrets](environments-and-secrets.md); how testers get a build is
[Build sharing](build-sharing.md).

## The full path at a glance

| Rung                 | Trigger                                                   | What moves                                                                                                              | Gate                                                                                       | Section                                                                                     |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **PR**               | open / push a PR into `main`                              | JS gate (`ci.yml`), native Maestro check (`e2e.yml`), web preview to the `pr-<number>` alias, fingerprint-drift comment | Required checks + review ([JS gate](js-gate.md)); nothing on the ladder moves              | [PR previews](#pr-previews-web-automatic), [Drift](#fingerprint-drift-on-prs-informational) |
| **`main` → staging** | the squash-merge (push to `main`)                         | OTA to channel `staging` (+ staging builds on a fingerprint miss), web `staging` alias, Slack post                      | none — automatic                                                                           | [Staging](#staging-automatic)                                                               |
| **staging → UAT**    | `workflow:run promote.yml -F target=uat` (by hand)        | The chosen **staging update group** republished to `uat`, unchanged (+ uat builds on a miss), web `uat` alias, Slack    | `require-approval` on expo.dev; fingerprint gate                                           | [UAT and production](#uat-and-production-manual)                                            |
| **UAT → production** | `workflow:run promote.yml -F target=production` (by hand) | The **same** group republished to `production`, web production URL, Slack                                               | `require-approval` on expo.dev; fingerprint gate **refuses** a runtime with no store build | [UAT and production](#uat-and-production-manual)                                            |
| **Store release**    | merge the release-please PR (it tags `vX.Y.Z`)            | Production store builds → TestFlight internal group + Play internal track; skipped when the fingerprint is unchanged    | GitHub `production` Environment reviewer (`.github/workflows/release.yml`)                 | [Store release](#store-release-tag)                                                         |
| **Back down**        | by hand                                                   | An earlier group republished on the channel, or a roll-back-to-embedded; web alias re-pointed                           | same gates as going up when done through `promote.yml`; none from the CLI                  | [Rollback](#rollback)                                                                       |
| **Backport**         | `workflow:run backport.yml -F tags=… -F fix=…` (by hand)  | A `main` fix cherry-picked onto older store release tags, published to `production` under each tag's runtime            | `require-approval` on expo.dev; fingerprint gate **refuses** a tag + fix whose hash moved  | [Backports](#backports-older-runtimes)                                                      |

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
- **A store release is required:** merge the open release-please PR (`chore(main): release x.y.z`),
  which tags `vX.Y.Z` → `.github/workflows/release.yml` → `.eas/workflows/release.yml`
  ([Store release](#store-release-tag)), then promote the staging group again. Never hand-edit
  `version` or push a tag ([ADR-0002](adr/0002-release-please-versioning.md)); to force a specific
  version, land a commit with a `Release-As: x.y.z` footer.

Drift you did not intend (a dependency bump that pulled a native module, a `package.json` `scripts`
edit, a changed icon) shows up the same way; `APP_VARIANT=production bun run fingerprint --debug`
on both branches lists every source that fed the hash ([environments and
secrets](environments-and-secrets.md#runtime-version--native-fingerprint)). The comparison is
relative, so build-time env such as `SENTRY_ORG` (unset in Actions, set on EAS) does not matter:
both sides are computed the same way. Fork PRs get a read-only token, so there the verdict lands
only in the job summary. The `fingerprint-drift` label is managed by `scripts/repo-settings.js`
(`bun run repo:settings:apply --only labels`, see [JS gate](js-gate.md#changing-the-required-set)).

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
| `slack`         | custom steps  | `after:` everything, so it posts on red runs too; composes the summary from `after.<job>` into a step output, then `eas/send_slack_message` posts it (skipped, with a log line, while `SLACK_WEBHOOK_URL` is unset)                           | –                                                         |

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
bun run eas workflow:run .eas/workflows/promote.yml -F target=production -F rollout_percentage=10   # staged rollout
bun run eas workflow:run .eas/workflows/promote.yml -F target=uat -F critical=yes                   # refuse a non-critical group
bun run eas workflow:run .eas/workflows/promote.yml --ref <commit> -F target=uat -F ios_builds=enabled -F hosting=enabled
bun run eas workflow:validate .eas/workflows/promote.yml                                    # after editing (cap: 16 KiB)
```

| Input                | Values                  | Default          | Meaning                                                                                                                                                             |
| -------------------- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`             | `uat` \| `production`   | `uat` (required) | Channel to promote to.                                                                                                                                              |
| `update_group_id`    | group id                | empty            | Which staging group. Empty = newest on the `staging` branch (`bun run eas update:list --branch staging --limit 1 --json`). Any group not on `staging` is refused.   |
| `rollout_percentage` | integer `1`–`100`       | `100`            | Share of **production** users served the update at once ([Staged rollouts](#staged-rollouts-production)); validated in `republish`, ignored for `uat` (always 100). |
| `critical`           | `yes` \| `no`           | `no`             | `yes` refuses the run unless the group already carries the critical flag ([Critical updates](#critical-forced-updates)); a republish cannot add it.                 |
| `web`                | `promote` \| `skip`     | `promote`        | Whether to move the web alias too (still needs `HOSTING`).                                                                                                          |
| `ios_builds`         | `enabled` \| `disabled` | `disabled`       | `IOS_BUILDS` repo constant (as in `deploy-staging.yml`): cut an iOS uat build on a miss. Needs the `uat` ad hoc credentials.                                        |
| `hosting`            | `enabled` \| `disabled` | `disabled`       | `HOSTING` repo constant: the dev-domain has been claimed by hand.                                                                                                   |

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

| Job                    | Type               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve`              | custom steps       | Picks the group (input or newest on `staging`), refuses one that is not on the `staging` branch, and exports `group_id`, per-platform `ios_runtime` / `android_runtime`, `commit`, `message`. Reads each platform's manifest (`manifestPermalink`) and logs `updatePolicy … → CRITICAL / not critical`; with `critical=yes` it fails when the group is not critical. Runs **before** the approval so the approver can read what they are approving. |
| `approve`              | `require-approval` | The gate. The run pauses on expo.dev (run page → Approve / Reject); any account member with access to the project can decide. Reject fails the job and, through `needs`, every job below it; nothing has been built or published yet.                                                                                                                                                                                                               |
| `fingerprint_<target>` | `fingerprint`      | The checkout's native fingerprint for the target variant (`preview` + `APP_VARIANT=uat`, or `production` + `APP_VARIANT=production` — must equal the `eas.json` profile).                                                                                                                                                                                                                                                                           |
| `get_build_<p>`        | `get-build`        | Newest finished build of the **target** profile whose fingerprint equals the **group's** runtime version — "can an installed uat / production build run these bytes?". `store` distribution for production, `internal` for uat. Skipped for a platform the group was not published for.                                                                                                                                                             |
| `gate`                 | custom steps       | The matrix below, per platform; exits 1 with the reason on a refusal. Outputs `build_ios` / `build_android`.                                                                                                                                                                                                                                                                                                                                        |
| `build_<p>`            | `build`            | uat only, on a miss: an internal-distribution `uat` build from this checkout (install page + QR). iOS also needs `IOS_BUILDS`.                                                                                                                                                                                                                                                                                                                      |
| `republish`            | custom steps       | `eas update:republish --group <id> --destination-channel <target> --non-interactive`, plus `--rollout-percentage <n>` when `target=production` and `rollout_percentage` < 100 (the log prints what was applied); `after:` the builds, so a failed uat build never blocks the OTA (it is keyed by runtime and harmless for a platform without a matching build). Message: `promote <id8> (staging → <target>): <original message>`.                  |
| `promote_web_<target>` | `deploy`           | Exports web from this checkout and deploys it to the `uat` alias / to production (`prod: true`). See _Web_ below.                                                                                                                                                                                                                                                                                                                                   |
| `slack`                | custom steps       | Same message shape as staging: verdict, group ids, install links, "reinstall required" when uat builds were cut (`scripts/eas/slack-compose.js promote`). Exits 0 while `SLACK_WEBHOOK_URL` is unset.                                                                                                                                                                                                                                               |

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

**Startup-TTI check before approving.** The approver can hold the group to the EAS Observe
budget: after a staging soak, `bun run observe:check --days <soak> --update-id <group>` (or the
`Observe check` workflow) must be green — the recipe, thresholds and how to turn it into a job in
this workflow are in [EAS Observe](observe.md#gating-on-tti-staging-soak--check--promote).

**Approval gates, side by side.** `promote.yml` runs on EAS, so its human gate is the
`require-approval` job on expo.dev. GitHub Environments `uat` and `production` (required
reviewer: the repo owner; created by `bun run repo:settings:apply` from
`scripts/repo-settings.js`) gate the **GitHub Actions** side of the same ladder: a job that
declares `environment: production` — `release.yml` (T5.3) and any later Actions-side promotion
step — waits for a reviewer before it runs. They do not apply to EAS workflow runs; they are
created now so both halves of the ladder carry the same named rungs.

**Which refs may deploy.** Each environment carries a deployment branch policy, and it must allow
the ref the job runs on or GitHub refuses the deployment _before_ the reviewer prompt — the run
fails instead of waiting. `release.yml` runs on `push` of a `v*` **tag**, which is not a protected
branch, so `production` allows branch `main` plus tag `v*` and `uat` allows branch `main`
(`DESIRED.environments[*].branch_policies` in `scripts/repo-settings.js`, see
[JS gate](js-gate.md#changing-the-required-set)). A new ref pattern goes in that list first, then
`bun run repo:settings:apply --only environments`; `bun run repo:settings:check --only environments`
reports drift.

## Update policies

How an installed app applies what the ladder publishes is decided in the app, not in the
workflows ([ADR-0003](adr/0003-update-policies.md); the one-file implementation is
`src/features/updates/use-update-policy.ts`, see
[Conventions → Updates go through `useUpdatePolicy`](conventions.md#updates-go-through-useupdatepolicy)):

| Lever                                          | Where                                                              | Effect                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_UPDATE_POLICY`                    | EAS environment variable (`preview` → staging + UAT, `production`) | Build-level policy: `silent` (default), `opt-in` (banner), `forced`. Recommended `forced` on `preview` so testers always run the newest group, `silent` on `production`.          |
| `EAS_UPDATE_CRITICAL=1`                        | Set on a single `eas update` (`deploy-staging.yml` `critical=yes`) | Marks that update forced through its manifest (`extra.expoClient.extra.updatePolicy`); promotion republishes the manifest unchanged, so the flag rides along to UAT / production. |
| `rollout_percentage`                           | `promote.yml` input, production only                               | Staged rollout: `eas update:republish --rollout-percentage <n>`; the rest of production keeps the previous group until the rollout is ramped to 100 (`rollout.yml`) or ended.     |
| Idle resume (`RESUME_RELOAD_AFTER_MS`, 30 min) | Code constant next to the hook                                     | A downloaded update is applied when the app comes back after ≥ 30 min in the background, under every policy, so a silent update does not wait for a cold start.                   |

### Staged rollouts (production)

`rollout_percentage` on `promote.yml` is honoured only for `target=production` — UAT testers
always get everyone, so the input is validated (integer 1–100) and then ignored there, with a log
line saying so. Below 100 the `republish` job passes `--rollout-percentage <n>`: EAS serves the
new group to that share of production installs (decided per install, stable across launches) and
the **previous latest group on the branch** to the rest. The rollout is a property of the new
group on the `production` branch, so every later step names **that** id (the `republish` job's
`group_id` output / the Slack post), not the staging one. Flags verified with
`bun run eas update:edit --help` / `update:rollback --help` (eas-cli 24).

```sh
bun run eas workflow:run .eas/workflows/promote.yml -F target=production -F update_group_id=<staging-id> -F rollout_percentage=10
bun run eas update:list --branch production --limit 2 --json        # the new group + what the other 90 % still run
bun run eas update:view <production-group-id> --insights --days 1   # launches, crash rate, unique users of the rollout so far

# Ramp — raise the percentage on the group behind an expo.dev approval; repeat until 100 (100 ends the rollout: everyone gets it):
bun run eas workflow:run .eas/workflows/rollout.yml -F update_group_id=<production-group-id> -F rollout_percentage=50
bun run eas workflow:run .eas/workflows/rollout.yml -F update_group_id=<production-group-id> -F rollout_percentage=100
# CLI fallback (any integer, no approval, no Slack post):
bun run eas update:edit <production-group-id> --rollout-percentage 60 --non-interactive

# End a bad rollout — publish the previous group again on top of it (same channel, no approval):
bun run eas update:rollback <production-group-id> --message "rollback: <why>" --non-interactive
```

Rules: ramp only **up** — installs that already received the group keep it, so lowering the number
takes nothing back; `update:rollback` needs the rollout group to be the branch's **latest**, so do
not promote another group on top of an open rollout — finish it (100) or end it first;
`update:rollback` on a rollout group republishes the group the other users were on, so the whole
channel converges on the old code (it is exactly the [Rollback](#rollback) mechanism, one command).
**Ramping** is `.eas/workflows/rollout.yml` (`Rollout`, `workflow_dispatch` only; not in
`promote.yml`, a different rung): `resolve` looks the group up (`scripts/eas/rollout-resolve.js`)
and refuses a group that is not on `production`, has no in-progress rollout, or would go _down_;
`approve` (`require-approval`) shows the approver the current percentage; then EAS's own
`update-rollout` job raises it; `slack` posts the result (same webhook as the promotion). The
input is a `choice` of `25` / `50` / `75` / `100`, one `update-rollout` job per value: eas-cli's
validator types the job's `rollout_percentage` as an integer and rejects an input expression
there, so any other number is the `update:edit` fallback above. Unverified until the first staged
rollout, like the rest of the native lane. UAT and staging never roll out: use them to find the
problem before production sees 10 % of it.

### Critical (forced) updates

A critical update is a **staging publish**, not a promotion: the flag lives in the manifest
(`extra.expoClient.extra.updatePolicy: 'forced'`, written by `app.config.ts` when
`EAS_UPDATE_CRITICAL=1`) and `eas update:republish` reuses the source manifest byte for byte, so
it can never be added, or removed, at promotion time.

1. Merge the fix to `main` as usual. The push-triggered staging run is **not** critical (a push has
   no inputs), so once it has published, dispatch the same commit with the input:
   `bun run eas workflow:run .eas/workflows/deploy-staging.yml --ref <sha> -F critical=yes`.
   The `update` job exports `EAS_UPDATE_CRITICAL=1`, the update message is prefixed `CRITICAL:`
   and the Slack post says 🚨 _critical_. The fingerprint is unchanged (`extra` is skipped by
   `fingerprint.config.js`), so no build is cut.
2. Verify on a staging build ([below](#verify-each-policy-on-a-staging-build)): the app must
   reload into it within one foreground session, whatever `EXPO_PUBLIC_UPDATE_POLICY` says.
3. Promote **that group** — `-F update_group_id=<id>` — to `uat`, then `production`, with
   `-F critical=yes`. The input changes nothing about the republish; it makes `resolve` read each
   platform's manifest and **fail before the approval** when the group is not critical (log:
   `updatePolicy ios=silent android=silent → not critical`), so nobody promotes the wrong group
   believing it is forced. Every run logs the policy, with or without the input.

A critical rollout is contradictory (forced on 10 % of users, silent for the rest) — promote a
critical group with `rollout_percentage=100` (the default). Rolling back a critical group is a
normal [rollback](#rollback): the rollback group is not critical, so users pick it up on the
next launch / idle resume rather than immediately.

### Verify each policy on a staging build

Every check needs an installed **staging build with updates enabled** (a `staging` profile build
from the build page, not a dev client) and a merge or dispatch that publishes a visible change —
bump a string on the Updates screen. Unit tests only prove the decision logic against a mocked
`expo-updates`; this is the owner-owed manual pass (ADR-0003 § 9). The Updates screen
(`src/features/updates`) shows the active policy, the running update id and manual check /
download buttons; `bun run eas update:view <group-id>` gives the id to compare against.

`EXPO_PUBLIC_UPDATE_POLICY` is an EAS environment variable, so a policy is switched by changing
it on the `preview` environment (`bun run eas env:set` or expo.dev → Environment variables)
**and publishing a new update** — the value is baked into the JS bundle, so a staging build only
runs a policy once it has downloaded a group exported with it. The recommended value on `preview`
is `forced`; set it back afterwards. (`production` stays `silent`.)

| Policy                | Set-up                                                                      | Publish                                                         | Expected on the staging build                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `silent`              | `EXPO_PUBLIC_UPDATE_POLICY` unset or `silent` on `preview`, one publish     | merge (or dispatch) a visible change                            | Nothing visible in the session that downloads it. Force-quit, relaunch: the change is there. Updates screen shows the new id.                                                                                                         |
| `opt-in`              | `EXPO_PUBLIC_UPDATE_POLICY=opt-in`, one publish so the build runs it        | merge a visible change                                          | Top banner "Update ready" within the session (launch or foreground check). **Later** hides it; **Restart now** reloads into the change. The banner does not return for the same group.                                                |
| `forced` (build)      | `EXPO_PUBLIC_UPDATE_POLICY=forced`, one publish                             | merge a visible change                                          | The app reloads into the change by itself, within seconds of launch or of coming to the foreground, with no prompt.                                                                                                                   |
| critical (per update) | `EXPO_PUBLIC_UPDATE_POLICY` = `silent` or `opt-in` (must **not** be forced) | `deploy-staging.yml` dispatch with `critical=yes`               | Same as forced, for this group only — no banner, immediate reload. A following non-critical publish behaves per the build policy again. `resolve` in `promote.yml` logs `→ CRITICAL` for the group.                                   |
| idle resume           | any policy except forced                                                    | merge a visible change; open the app once so it downloads       | Background the app ≥ 30 min (`RESUME_RELOAD_AFTER_MS`) with the update downloaded (Updates screen: pending), foreground it: the app reloads into the change. Under 30 min it does not.                                                |
| staged rollout        | production only — a second device or tester on the production build         | promote with `rollout_percentage=10`, then `rollout.yml` to 100 | `update:view <production-group> --insights` counts launches for the group; `update:list --branch production` shows the rollout group as latest. There is no per-install way to force a device into the rollout bucket — ramp instead. |

## Store release (tag)

**Workflows:** two files, one gate. `.github/workflows/release.yml` (`Release`, GitHub Actions) runs
on `push` of a `v*` tag; its single `trigger` job declares `environment: production`, so it waits
for the required reviewer (`scripts/repo-settings.js`, whose `production` deployment branch policy
must allow the `v*` tag for the prompt to appear at all) and then runs
`bun run eas workflow:run .eas/workflows/release.yml -F tag=<tag>` with `EXPO_TOKEN` (fails early
with a readable error when the secret is missing). `.eas/workflows/release.yml` (`Release`, EAS)
is `workflow_dispatch`-only: EAS does support `on: push: tags:`, but a tag trigger there would
bypass the GitHub reviewer, which is the whole point of the split. Production RCs land in the
**TestFlight internal group** and the **Play internal track** (PLAN.md decision 12); nothing here
touches App Store review or Play production.

**The release PR** ([ADR-0002](adr/0002-release-please-versioning.md)). release-please
(`.github/workflows/release-please.yml`, on every push to `main`) keeps one release PR open —
`chore(main): release 1.2.3`, label `autorelease: pending` — holding the next version in
`package.json` (the single source of truth; `app.config.ts` reads it) and the generated
`CHANGELOG.md` entry, and updates it on every merge. `feat` → minor, `fix` / `perf` / `revert` →
patch, `!` / `BREAKING CHANGE` → major; `chore` / `docs` / `ci` / `test` / `build` / `refactor` /
`style` never open one, and every Renovate PR is `chore(deps)`, so a dependency bump never releases
by itself. `version` tracks every release, OTA-only ones included: the unchanged-fingerprint rule
below turns a tag without native changes into a green no-op store step. Build numbers stay on EAS
(`appVersionSource: remote`, `autoIncrement`); nobody hand-edits `version` anywhere.

**Cutting a release** — two human steps, neither automated. Nobody bumps `version` or pushes a tag
by hand; to force a particular number, land a commit whose footer is `Release-As: x.y.z` and
release-please cuts that version next.

1. **Merge the release PR.** release-please tags the squash commit `vX.Y.Z` (label →
   `autorelease: tagged`) and the tag starts `.github/workflows/release.yml`. The staging deploy
   runs on the same commit as usual, so the tagged tree always exists as a staging update group
   whose reported version equals the tag.
2. **Approve the `production` environment** on the GitHub run (Actions → Release → Review
   deployments). Nothing is built or submitted before this.
3. Follow the EAS run (expo.dev → project → Workflows, or the Slack post). Manual equivalent:

```sh
bun run eas workflow:run .eas/workflows/release.yml -F tag=v1.2.3                 # repo constants
bun run eas workflow:run .eas/workflows/release.yml -F tag=v1.2.3 -F force=yes -F platforms=android
bun run eas workflow:validate .eas/workflows/release.yml                          # after editing (cap: 16 KiB)
```

| Input         | Values                       | Default    | Meaning                                                                                                        |
| ------------- | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `tag`         | `vX.Y.Z`                     | (required) | The tag release-please pushed; must equal `v` + `package.json` `version`, anything else fails `version_check`. |
| `platforms`   | `both` \| `ios` \| `android` | `both`     | Platforms to release.                                                                                          |
| `force`       | `no` \| `yes`                | `no`       | `yes` = build + submit even when a store build with this fingerprint already exists.                           |
| `ios_release` | `enabled` \| `disabled`      | `disabled` | `IOS_RELEASE` repo constant (below).                                                                           |
| `play_submit` | `enabled` \| `disabled`      | `disabled` | `PLAY_SUBMIT` repo constant (below).                                                                           |

```text
version_check ── fingerprint ─┬─ check_ios ─────┐
                              └─ check_android ─┴─ gate ─┬─ build_ios (IOS_RELEASE) ── testflight_ios (TestFlight)
                                                         └─ build_android ─────────── submit_android (PLAY_SUBMIT)
                                                                                          └───── notify (Slack)
```

| Job              | Type          | What it does                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version_check`  | custom steps  | Refuses a tag that is not `vX.Y.Z` or does not equal `v` + `expo config` `version` (`APP_VARIANT=production`), with the fix printed (merge the release-please PR, or delete the tag). Outputs `version`.                                                                                     |
| `fingerprint`    | `fingerprint` | `environment: production`, `APP_VARIANT=production` — must equal the `production` build profile.                                                                                                                                                                                             |
| `check_<p>`      | `get-build`   | Newest finished **store** build of the `production` profile with this fingerprint (`wait_for_in_progress`, so a release already building counts). Skipped for an unselected platform.                                                                                                        |
| `gate`           | custom steps  | Per selected platform: hit + `force=no` → **skip** with `fingerprint unchanged since last store build <id>; nothing to release — bump native deps or use force=yes`, **exit 0** (the run stays green); miss or `force=yes` → `release_<p>=true`.                                             |
| `build_<p>`      | `build`       | `production` profile (`distribution: store`, `channel: production`, `autoIncrement`). Message `release <tag> (<version>)`. iOS also needs `IOS_RELEASE`.                                                                                                                                     |
| `testflight_ios` | `testflight`  | EAS's TestFlight job (`submit.production` profile): uploads the build, adds it to the internal group **`Internal`** (`TESTFLIGHT_GROUP` constant — a group _without_ automatic distribution, created once in App Store Connect), sets "What to Test" to `Release <tag>`, no Beta App Review. |
| `submit_android` | `submit`      | `submit.production` in `eas.json`: Android `track: internal`. Needs `PLAY_SUBMIT`.                                                                                                                                                                                                           |
| `notify`         | custom steps  | Same Slack job as staging: verdict, build links, where each platform landed (TestFlight group `Internal` / Play internal track), run URL. Exits 0 while `SLACK_WEBHOOK_URL` is unset (`production` environment).                                                                             |

**Unchanged-fingerprint rule.** A store build is only worth cutting when the native surface
changed: the OTA lane already carries every JS-only change to installed production apps
(`promote.yml`). So a tag whose fingerprint already has a store build (per platform) is a **skip**,
not a failure — the run is green, the Slack post says `⏭️ skipped`, and nothing is built or
submitted. To ship a store build anyway (store listing changes, a re-submit, a rejected binary),
re-run with `force=yes`. This is the mirror of the production promotion rule: `promote.yml`
refuses a group whose fingerprint has no store build; `release.yml` is how that build comes to
exist. After a release with a new fingerprint, promote the staging group again — it now hits.

**Where things land.** iOS: App Store Connect → TestFlight → the build appears under the internal
group `Internal` (plus any group with automatic distribution), "What to Test" = `Release <tag>`.
The group name is a repo constant (`TESTFLIGHT_GROUP`, `internal_groups` on `testflight_ios`) and
the group must exist and must _not_ auto-distribute, or the job fails — [iOS runbook, step
6](environments-and-secrets.md#ios-runbook-owner). Android: Play Console → Testing → Internal
testing. Neither is a store release; promotion to review / production tracks stays manual in the
consoles for now (D1).
Builds: expo.dev → project → Builds, message `release <tag> (<version>)`.

**Repo constants (flip in one PR: the `|| '<literal>'` on the job `if` and the matching
`workflow_dispatch` input default).**

| Constant      | Default    | Job              | Enable when                                                                                                                                                                                                                           |
| ------------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IOS_RELEASE` | `disabled` | `build_ios`      | App Store credentials for `production` and the App Store Connect API key are on EAS and `ascAppId` is in `submit.production.ios` ([iOS runbook](environments-and-secrets.md#ios-runbook-owner), steps 4–6). `testflight_ios` follows. |
| `PLAY_SUBMIT` | `disabled` | `submit_android` | The first AAB was uploaded to Play by hand and the service-account key is on EAS ([Google Play runbook](environments-and-secrets.md#google-play-runbook-owner)). Android builds run either way.                                       |

**Holding, skipping and re-cutting.** To hold a release, leave the release PR open — it keeps
collecting merges and re-rendering; do not close it (release-please reopens one on the next push).
To force a version, put a `Release-As: 1.3.0` footer in a commit body (the PR title becomes the
squash commit, so a footer goes in the PR body, not the title). To re-run a tag's store step (a
rejected binary, listing changes) re-run the EAS release with `force=yes`; never re-tag.
`fingerprint.config.js` skips `version`, so the release commit itself never changes the native
fingerprint.

Also owed: `RELEASE_PLEASE_TOKEN` and `EXPO_TOKEN` as GitHub repository secrets (both workflows
fail early without theirs), the `autorelease: *` labels and the GitHub `production` environment
(`bun run repo:settings:apply`). All on the
[human setup checklist](environments-and-secrets.md#human-setup-checklist-owner).

## Rollback

An OTA rollback is **never an undo**: it is one more update group published on the branch, whose
bytes happen to be an earlier group's (or the binary's embedded bundle). Installed apps pick it up
exactly like any other update — under the default `silent` policy ([Update policies](#update-policies))
that means the next launch or foreground check downloads it and the launch after that (or an
[idle resume](#update-policies) after ≥ 30 min in the background) runs it; a `forced` build, or a
critical group, reloads at once. The bad group stays in the branch history
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
  native regression needs a **fix release**: merge the `fix:` PR, then merge the release-please PR
  it opens, which tags the next patch ([Store release](#store-release-tag)). The gate skips a tag whose fingerprint already has a store build —
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
   - **Native:** merge the release-please PR the fix opened (it tags `vX.Y.Z`), approve the
     `production` Environment, wait for `release.yml` to cut the store build, then promote the
     staging group — the fingerprint gate now hits. Until users install the new binary they are on
     the rolled-back OTA from step 1.
   - **JS-only, and users are still on an older store runtime:** the promotion above reaches only
     installs whose binary has `main`'s fingerprint. For the rest, [backport](#backports-older-runtimes)
     the merged fix commit onto the tag(s) they run — after the promotion, not instead of it.
5. Verify as above; close the loop in the Slack thread that announced the rollback.

Never publish a fix straight to `production` with `eas update --channel production` from a laptop:
it would bypass staging, the approval, the fingerprint gate and Sentry source maps, and would
create a production group with no staging twin — which the next `promote.yml` run cannot see. The
one sanctioned exception is `backport.yml` below, which keeps the approval and the fingerprint gate.

## Backports (older runtimes)

**Workflow:** `.eas/workflows/backport.yml` (`Backport`, `workflow_dispatch` only;
[ADR-0008](adr/0008-multi-runtime-ota-backports.md)). **Unverified:** the repo has no store
release yet, so the workflow has only passed `eas workflow:validate`; the ADR lists what the first
real run must confirm.

### When a backport is needed

An update only reaches builds with the same fingerprint, and the runtime version _is_ the
fingerprint — `eas update` cannot override it, it is computed from the checked-out tree. Every
store release whose fingerprint moved (a native dependency, a config plugin, an SDK upgrade)
leaves a runtime behind: the installs that never took the store update keep the old binary and
get **nothing** from `main`'s groups, however many times you promote. A backport is a JS-only fix
from `main` published from a tree whose fingerprint equals that old runtime: the release tag's
tree with the fix cherry-picked on top. It is worth doing when the fix matters to those users
(a crash, a broken flow, a data bug) and they are still numerous; it is never a substitute for
the normal ladder — promote the fix for the current runtime first ([Hotfix](#hotfix) step 4).

### Pick the targets

Nothing is automatic ("last N" would backport to runtimes nobody runs). Per run you name the
tags, and each tag stands for a runtime through its store build's fingerprint:

```sh
bun run eas build:list -p ios -e production --distribution store --status finished --json --non-interactive     # fingerprint.hash + gitCommitHash per store build
bun run eas build:list -p android -e production --distribution store --status finished --json --non-interactive
bun run eas channel:view production                                              # what production serves, per runtime
bun run eas update:list --branch production --runtime-version <fingerprint>      # groups already on that runtime (backports land here)
bun run eas update:view <group-id> --insights --days 7                           # launches / unique users of the group
```

Which runtimes still have users: EAS Update insights (expo.dev → Updates → the `production`
branch, or `update:view --insights` on the newest group of each runtime) give launches and unique
users per group, and the embedded-vs-OTA split per runtime; a runtime whose newest group has no
launches in a week has no users worth a backport. Map a fingerprint to its tag through the store
build's `gitCommitHash` (`git tag --contains <sha>`, or `bun run eas build:view <build-id>`).
Note that a tag whose fingerprint did not move never got its own build (`release.yml` skipped it)
— the workflow looks builds up **by fingerprint**, so such a tag still works as a target.

### Dispatch

```sh
bun run eas workflow:run .eas/workflows/backport.yml -F tags=v1.2.0,v1.1.0 -F fix=<fix sha on main> [-F rollout_percentage=10] [-F platforms=ios] [-F message="…"]
```

`fix` is the **squash commit on `main`** (the merged PR, `git log --oneline -5`), not the PR
branch. The run:

1. `resolve` — validates the inputs (`rollout_percentage` 1–100; `ref` needs exactly one tag;
   `fix` must be on `origin/main`), fetches the tags, and prints per tag and platform the
   fingerprint of the **clean** tag tree and the production store build that runs it
   (`NONE` = nothing to backport to). Read this before approving.
2. `approve` — `require-approval` on the run page.
3. `backport` — one job, looping over the tags: checkout the tag, `git cherry-pick -x <fix>`,
   `bun install`, `bun run fingerprint --platform <p>` for both platforms, and the gate: the
   fingerprint of tag + fix must **equal** the clean tag's, and that hash must have a store build.
   Passing platforms get `eas update --channel production --environment production -p <…>
--rollout-percentage <n> -m "backport <fix7> onto <tag>: <subject>"`; the log prints the group
   id and its expo.dev link. Every tag is attempted; the job fails at the end if any tag failed.
   Sentry source maps are uploaded best-effort (`bun run sentry:sourcemaps`, skipped without
   `SENTRY_*` on `production`).

### What the gate refuses, and why

| Log line                                                | Meaning                                                                                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<tag>/<p>: REFUSED — fingerprint <a> != <b>`           | The fix touched the native surface on that platform (a dependency with native code, a plugin, `app.config.ts` outside `version` / `extra`). It is **not OTA-safe** for that tag: it needs a [fix release](#store-release-tag). The other platform may still publish. |
| `<tag>/<p>: REFUSED — no production store build runs …` | No store build has the tag tree's fingerprint on that platform — nobody can run the update. Wrong tag, or a platform that never shipped.                                                                                                                             |
| `<tag>: FAIL — cherry-pick of <fix> conflicts`          | The fix does not apply cleanly to the tag. Resolve it locally with the recipe below and re-run with `ref`.                                                                                                                                                           |
| `<tag>: FAIL — <ref> does not contain tag <tag>`        | The prepared branch was not cut from the tag; `git checkout -b backport/<tag> <tag>` and cherry-pick again.                                                                                                                                                          |

Nothing is published for a refused platform, ever: publishing a mismatched tree would create a
group under a runtime that **no** build matches (unreachable) or, worse, one that a binary matches
while the JS assumes native code it does not have.

### Conflict recipe

Printed by the job, too. Keep the resolution JS / assets only — the fingerprint check at the end
is the same one the gate runs:

```sh
git fetch origin --tags
git checkout -b backport/v1.2.0 v1.2.0
git cherry-pick -x <fix sha>      # resolve conflicts, keep the change OTA-safe (JS/assets only)
bun run fingerprint --platform ios && bun run fingerprint --platform android   # must equal the tag's
git push -u origin backport/v1.2.0
bun run eas workflow:run .eas/workflows/backport.yml -F tags=v1.2.0 -F ref=backport/v1.2.0 [-F rollout_percentage=10]
```

With `ref`, `tags` must be exactly that one tag and no cherry-pick happens; the job checks the
tag is an ancestor of the branch, then gates and publishes as above. The `backport/*` branch is
throwaway: delete it after the run (nothing on the ladder reads it).

### Ramp and rollback

A backport group is a normal `production` group under the tag's runtime, so the
[staged rollout](#staged-rollouts-production) and [Rollback](#rollback) mechanics apply
**per runtime**; filter with `--runtime-version` so you act on the right one (flags verified with
`update:rollback --help` / `update:republish --help`, eas-cli 24):

```sh
bun run eas update:list --branch production --runtime-version <fingerprint> --limit 3   # the backport must be the newest group for that runtime
bun run eas update:view <backport-group-id> --insights --days 1                          # adoption / crash rate on the old runtime
bun run eas workflow:run .eas/workflows/rollout.yml -F update_group_id=<backport-group-id> -F rollout_percentage=100   # ramp (up only; or update:edit)
bun run eas update:rollback <backport-group-id> --message "rollback: <why>" --non-interactive            # back to what that runtime ran before (or embedded)
bun run eas update:republish --group <earlier-group-id> --message "rollback: <why>" --non-interactive   # a specific earlier group of that runtime
```

`update:rollback` takes the group id (it must be the newest on the branch **for its runtime**)
and republishes the one before it on that runtime — an earlier backport, or nothing, in which case
it rolls that runtime back to embedded. `-p ios|android` limits either command to one platform.
Post in Slack by hand (the workflow has no Slack job yet — ADR-0008 follow-up), naming the tag and
runtime so nobody confuses it with the current promotion.
