# Release ladder

`main` → **staging** (automatic, this page) → **UAT** → **production** (manual, approval-gated
republishes of the same update group — T5.2) → stores on a version tag (T5.3). Channel / branch
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
  `bun run eas update:view <group-id>` the platforms in it. T5.2 promotes that group id — it is also
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

_T5.2 — `promote.yml`: `require-approval` → fingerprint gate → republish the chosen staging update
group to `uat` / `production`, promote the web alias._

## Rollback

_T5.7 — `eas update:republish` / `eas update:rollback`, per channel, plus the web alias._
