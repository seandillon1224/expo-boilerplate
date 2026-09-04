# Release ladder

`main` → **staging** (automatic, this page) → **UAT** → **production** (manual, approval-gated
republishes of the same update group, below) → stores on a version tag (T5.3). Channel / branch
mapping and the environment variables each rung reads:
[Environments and secrets](environments-and-secrets.md).

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

| Constant     | Default    | Job          | Enable when                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IOS_BUILDS` | `disabled` | `build_ios`  | The iOS ad hoc credentials for `staging` exist ([iOS runbook](environments-and-secrets.md#ios-runbook-owner), steps 1–3). Until then every iOS build fails at `Credentials are not set up`.                                                                                                                                                                                                                  |
| `HOSTING`    | `disabled` | `deploy_web` | The owner has made the project's first deployment by hand — it claims the dev-domain and is interactive: `bun run export:web && bun run eas deploy --environment preview --export-dir dist-web --dev-domain expo-boilerplate --alias staging`. Prove the export is deployable without spending anything with `--dry-run` (writes `deploy.tar.gz`, gitignored). `bun run init` (T7.1) renames the dev-domain. |

Slack has no constant: create the incoming webhook (T5.6 wires the channel) and store it as
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
`uat` and later to `production` — never a group that only exists on `uat`. Rollback is T5.7.

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

## Rollback

_T5.7 — `eas update:republish` / `eas update:rollback`, per channel, plus the web alias._
