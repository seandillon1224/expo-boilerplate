# Owner checklist

Everything the pipeline needs that only a human with an Apple / Google / Slack / GitHub / Expo
login can provide. Nothing here is a code change; nothing here happens by itself. Until an item is
done the job that needs it skips itself with a notice and the run stays green, so a fresh project
is shippable on day one and gets more of the ladder as the list gets ticked.

**This file is per-project state.** Tick the boxes as you go and commit it — `bun run init` copies
it into a new project untouched (no rewrites, no reset; `KEEP` in `scripts/init.js`), because what
the previous owner set up says nothing about your accounts.

Every item carries the same four lines:

| Line         | Means                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| the checkbox | the action, in the place it is done                                                                                 |
| **Unlocks**  | what starts working — usually a job that skips today                                                                |
| **Flip**     | the repo constant to change in the same or a follow-up PR ([repo constants](ci-overview.md#repo-constants)), or `—` |
| **Proof**    | the command or screen that shows it took                                                                            |

Groups are ordered by how early you need them: [merge gate](#merge-gate) →
[staging](#staging) → [store release](#store-release) → [optional](#optional) →
[template repo upkeep](#template-repo-upkeep). [First real runs still owed](#first-real-runs-still-owed)
tracks the lanes that exist but have never executed — every "Unverified" callout in these docs
points there.

## Merge gate

What has to be true for a PR to be gated properly on `main`.

### Push branch protection, merge settings and labels

- [x] `bun run repo:settings:apply` (first run after creating the repo; `bun run init` offers it)
- [ ] re-run it after any change to `REQUIRED_CHECKS` or `LABELS` in `scripts/repo-settings.js`
- **Unlocks:** every JS-gate job becomes a required check on `main`, squash-only merging with
  auto-merge for Renovate, and the labels the workflows key on (`web-preview`, `e2e:cloud`,
  `e2e:ios`, `fingerprint-drift`, `flaky-flow`, `autorelease: *`).
- **Flip:** —
- **Proof:** `bun run repo:settings:check` prints `in sync`. A subset: `--only protection|repo|environments|labels|pages`.
- **More:** [JS gate → Changing the required set](js-gate.md#changing-the-required-set).

### GitHub Environments (`uat` and `production`)

- [ ] `bun run repo:settings:apply --only environments`, then add yourself as the required reviewer
      if the API did not (Settings → Environments)
- **Unlocks:** the reviewer prompt on `.github/workflows/release.yml`, **and** its deployment
  branch policies — `production`: branch `main` + tag `v*`, `uat`: branch `main`. Without the
  `v*` tag policy a tag-triggered release deployment is refused _before_ the reviewer sees it.
- **Flip:** —
- **Proof:** `bun run repo:settings:check` no longer reports `environments.<name>: …`.

### Link the Expo GitHub App

- [ ] expo.dev → account → project → **GitHub** → install the app and link the repository (the Expo
      user needs a linked GitHub account)
- **Unlocks:** every `pull_request` / `push` trigger in `.eas/workflows/` (`e2e.yml`,
  `preview-web.yml`, `deploy-staging.yml`), the `github-comment` jobs, and EAS runs reporting
  back as PR checks. No `EXPO_TOKEN` is involved — EAS triggers itself from the webhook.
- **Flip:** —
- **Proof:** open a PR; the run appears on expo.dev → Workflows and `gh pr checks <n>` lists the EAS
  context.
- **More:** [Native E2E → Human prerequisites](native-e2e.md#human-prerequisites-once).

### Make `E2E (native)` a required check

- [ ] after the first PR run: read the exact context string from `gh pr checks <n>`, add it verbatim
      to `REQUIRED_CHECKS` in `scripts/repo-settings.js`, run `bun run repo:settings:apply`
- **Unlocks:** the native lane actually gates merges instead of being informational.
- **Flip:** — (optionally tier iOS down with `IOS_MODE` in `e2e.yml`)
- **Proof:** `bun run repo:settings:check` is clean and the check shows **Required** on a PR.
- **Budget:** the first run has no cached base build and cuts two paid builds (~15 min each); every
  JS-only PR after that repacks.
- **More:** [JS gate → How EAS checks appear on the PR](js-gate.md#how-eas-checks-appear-on-the-pr).

## Staging

Everything `deploy-staging.yml` needs to do more than publish an OTA update.

### Slack release webhook

- [ ] create the channel and an incoming webhook
      ([Build sharing → Create the channel and webhook](build-sharing.md#create-the-channel-and-webhook-owner-once)),
      then store it on EAS:

```sh
bun run eas env:set --scope project --environment preview --environment production \
  --name SLACK_WEBHOOK_URL --value https://hooks.slack.com/services/... \
  --visibility secret --type string --non-interactive
```

- **Unlocks:** the `slack` / `notify` jobs of `deploy-staging.yml`, `promote.yml`, `release.yml` and
  `rollout.yml` — the install links designers and testers use.
- **Flip:** — (the job exits 0 with `SLACK_WEBHOOK_URL is not set … skipping` while unset)
- **Proof:** `bun run eas env:list --environment preview --format long` shows the name (never the
  value); the next push to `main` posts.

### Claim the EAS Hosting dev-domain

- [ ] one interactive deployment by hand:
      `bun run export:web && bun run eas deploy --environment preview --export-dir dist-web --dev-domain <slug> --alias staging`
- **Unlocks:** web on the ladder — `staging` / `uat` / production aliases and the `pr-<number>` PR
  previews.
- **Flip:** `HOSTING` → `enabled` in `deploy-staging.yml`, `preview-web.yml` **and** `promote.yml`
  (constant + matching input default) in one PR.
- **Proof:** the alias resolves; a PR labelled `web-preview` gets a comment with its `pr-<n>` URL.

### iOS ad hoc credentials (`staging`, `uat`)

- [ ] register at least one device (`bun run devices:add`), then
      `bun run eas credentials -p ios` for each profile
- **Unlocks:** installable iOS staging builds (the QR / install page testers use), and the `uat`
  build when a promotion needs one.
- **Flip:** `IOS_BUILDS` → `enabled` in `deploy-staging.yml` and `promote.yml`; `promote.yml` also
  takes `-F ios_builds=enabled` per run.
- **Proof:** `bun run eas credentials -p ios` shows a distribution certificate + ad hoc profile per
  application id.
- **More:** [iOS runbook](environments-and-secrets.md#ios-runbook-owner),
  [Device onboarding](device-onboarding.md).

### Sentry DSN and source maps

- [ ] set the four variables on EAS (the DSN is the only `EXPO_PUBLIC_` one — the rest are
      build-time and must never reach the bundle):

```sh
# Runtime DSN — one DSN per environment, or the same one three times.
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name EXPO_PUBLIC_SENTRY_DSN --value https://<key>@o<org>.ingest.sentry.io/<project> \
  --visibility plaintext --type string --non-interactive

# Build-time source-map upload (NOT EXPO_PUBLIC_).
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_ORG --value <sentry-org-slug> --visibility plaintext --type string --non-interactive
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_PROJECT --value <sentry-project-slug> --visibility plaintext --type string --non-interactive
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_AUTH_TOKEN --value <token> --visibility secret --type string --non-interactive
```

- [ ] add `SENTRY_AUTH_TOKEN` as a GitHub repository secret too, if `bun run sentry:sourcemaps` ever
      runs from GitHub Actions rather than EAS
- **Unlocks:** symbolicated stack traces. `src/lib/sentry.ts` is a no-op until the DSN exists.
- **Flip:** set `upload_sentry_sourcemaps: true` on the `update` job of `deploy-staging.yml` so a
  broken upload fails the run instead of shipping unsymbolicated errors.
- **Proof:** `bun run eas env:list --environment production --format long`; a test error appears in
  Sentry with real frames.

### Real values behind `EXPO_PUBLIC_API_URL`

- [ ] point each environment at its backend with the same `env:set` command (it creates or updates
      in place); document any new key in `.env.example`
- **Unlocks:** staging / UAT / production talking to something other than the schema default.
- **Flip:** —
- **Proof:** `bun run env:pull` then `bun run env:check`.
- **More:** [Environments and secrets → Variables](environments-and-secrets.md#variables).

## Store release

### GitHub repository secrets

- [ ] `EXPO_TOKEN` — an EAS [robot / personal access token](https://docs.expo.dev/accounts/programmatic-access/);
      `.github/workflows/release.yml` starts the EAS release with it
- [ ] `RELEASE_PLEASE_TOKEN` — **not** the built-in `GITHUB_TOKEN`: events it creates trigger no
      other workflow, so the release PR would have no required checks and the tag would never start
      `release.yml`. Either a **GitHub App** on the owning account (repository permissions
      _Contents: read & write_ and _Pull requests: read & write_; store the App id / private key as
      `RELEASE_PLEASE_APP_ID` / `RELEASE_PLEASE_APP_PRIVATE_KEY` and add an
      `actions/create-github-app-token` step before release-please) or a **fine-grained PAT** scoped
      to this repository with the same two permissions — set an expiry reminder.
- **Unlocks:** the release PR, the `vX.Y.Z` tag, and the EAS release run.
- **Flip:** —
- **Proof:** `gh secret list`; release-please opens `chore(main): release x.y.z` on the next push to
  `main`.
- **More:** [ADR-0002](adr/0002-release-please-versioning.md).

### Apple: App Store credentials and the ASC API key

- [ ] Apple Developer Program membership active for the team that owns the production bundle id
- [ ] `bun run eas credentials -p ios` → `production`: distribution certificate + **App Store**
      provisioning profile
- [ ] App Store Connect API key (`.p8`) stored on EAS, so `eas submit` runs with `EXPO_TOKEN` only
- [ ] App Store Connect app record created, `ascAppId` added to `submit.production.ios` in `eas.json`
      (a PR)
- **Unlocks:** the `build_ios` + `testflight_ios` jobs of `.eas/workflows/release.yml`.
- **Flip:** `IOS_RELEASE` → `enabled` in `.eas/workflows/release.yml`.
- **Proof:** `bun run eas credentials -p ios` lists the key; a `v*` tag run reaches TestFlight.
- **More:** [iOS runbook](environments-and-secrets.md#ios-runbook-owner).

### App Store Connect: the `Internal` TestFlight group

- [ ] create an internal group named exactly **`Internal`** (`TESTFLIGHT_GROUP` in
      `.eas/workflows/release.yml`), _without_ automatic distribution
- **Unlocks:** the `testflight_ios` job's upload target; "What to Test" is set to `Release <tag>`.
  Renaming the group means changing the constant in the same PR.
- **Flip:** —
- **Proof:** App Store Connect → TestFlight → Groups shows `Internal`; the first release build lands
  in it.
- **More:** [Release ladder → Store release](release-ladder.md#store-release-tag).

### Google Play: first AAB and the service-account key

- [ ] create the Play app, upload the first AAB by hand (Play refuses an API upload before one
      exists), create a service account and upload its JSON key to EAS
- **Unlocks:** the `play_submit` job of `.eas/workflows/release.yml` (internal track).
- **Flip:** `PLAY_SUBMIT` → `enabled` in `.eas/workflows/release.yml`.
- **Proof:** `bun run eas credentials -p android` shows the service account under Service
  Credentials; a tag run lands on the internal track.
- **More:** [Google Play runbook](environments-and-secrets.md#google-play-runbook-owner).

### Cut the first release

- [ ] merge the open release-please PR (it tags `vX.Y.Z`), then approve the `production` Environment
      on the GitHub `Release` run
- **Unlocks:** the first store build — and with it the ability to promote to production after a
  fingerprint-moving change, and to run a [backport](release-ladder.md#backports-older-runtimes)
  at all (both need a store release tag to exist).
- **Flip:** —
- **Proof:** the tag exists, the label on the PR flips to `autorelease: tagged`, and the EAS
  `Release` run is green (a no-op when the fingerprint is unchanged).

## Optional

Nothing here blocks the ladder; each is a plan or a judgement call.

### Maestro Cloud (real-device farm)

- [ ] a Maestro Cloud plan → API key + project id
- [ ] `bun run eas env:create --scope project --environment development --name MAESTRO_CLOUD_API_KEY --value <key> --visibility secret --type string --non-interactive`
- [ ] replace `proj_REPLACE_ME` in both `cloud_<p>` jobs of `.eas/workflows/e2e-cloud.yml`
- **Unlocks:** the `e2e:cloud` label running the same flows on real devices.
- **Flip:** `MAESTRO_CLOUD` → `enabled` in `e2e-cloud.yml` (three `if:` literals + the input default).
- **Proof:** label a PR `e2e:cloud`; the Maestro Cloud console shows the run.
- **More:** [Native E2E → Maestro Cloud](native-e2e.md#maestro-cloud-optional),
  [ADR-0006](adr/0006-maestro-cloud-optional-job.md).

### Flashlight (Android release-build CPU / RAM / FPS)

- [ ] nothing to buy — decide whether the informational hook is worth the minutes
- **Unlocks:** a Flashlight report artifact after the Android Maestro step.
- **Flip:** `FLASHLIGHT` → `enabled` in `.eas/workflows/e2e.yml`, or dispatch with
  `-F flashlight=enabled`.
- **Proof:** the run's artifacts carry the report; locally `bun run perf:flashlight`.
- **More:** [Performance → Flashlight](performance.md), [ADR-0007](adr/0007-flashlight-android-perf-hook.md).

### Re-base the Observe budget on real data

- [ ] after a staging soak with real launches, set `ios` / `android` limits in `observe-budget.json`
      from measured p90s instead of the seeded guesses
- **Unlocks:** a TTI budget that means something — and the option of making it a promotion gate
  (reviewer rule, or a job between `resolve` and `approve` in `promote.yml`).
- **Flip:** — (`--strict` on `observe:check` turns skips into failures)
- **Proof:** `bun run observe:check --days 7` reports `OK` rows rather than `SKIP` /
  insufficient data.
- **More:** [Observe → Gating on TTI](observe.md#gating-on-tti-staging-soak-check-promote).

### Make the a11y audit gating

- [ ] after the first green EAS run shows real reports in the **A11y audit** artifact, drop
      `--no-fail` from the `after_maestro_tests` hook in `.eas/workflows/e2e.yml`
- **Unlocks:** unlabeled pressables and duplicate labels failing the native lane instead of being
  informational.
- **Flip:** — (the flag is the switch)
- **Proof:** a deliberate missing label turns the job red.
- **More:** [ADR-0005](adr/0005-a11y-hierarchy-audit.md), [Testing → Accessibility audit](testing.md#accessibility-audit).

## Template repo upkeep

Only relevant while this is the template repo, or right after `bun run init`.

### Take Renovate out of Silent mode

The Renovate app **is** installed. The Mend repo setting `Dependency Updates (Renovate)` is
**Silent**, which runs the job and computes every update but creates no PRs and no issues — so the
dashboard shows jobs `DONE` while the repo has zero `renovate/*` branches and zero Renovate PRs.
Do not read an empty `gh pr list --author app/renovate` as "not installed"; both states look
identical from the repo side.

- [x] Run `bun run repo:settings:apply` **first** — auto-merge (`platformAutomerge: true` for dev
      tooling patch/minor) is gated only by the required checks on `main`, and `Docs` is not live
      yet. Enabling Renovate before this lets a dependency bump auto-merge past a broken docs build.
- [x] [developer.mend.io](https://developer.mend.io) → this repo → Repo Engine Settings →
      `Dependency Updates (Renovate)` → change **Silent** to **Enabled** (use the repo SETTINGS
      override if the value is inherited from the org default).
- **Unlocks:** dependency PRs (`chore(deps)`, auto-merge per `scripts/repo-settings.js`).
- **Flip:** the Mend setting only — nothing in this repo changes.
- **Proof:** `gh pr list --author app/renovate` is non-empty; `bunx expo install --check` stops
  reporting Expo packages behind.

Two things that make "nothing happened" look like a failure when it isn't:

- `schedule: ['before 6am on monday']` gates branch and PR creation. Outside that window Renovate
  still runs and still updates the **Dependency Dashboard** issue (`config:recommended` enables it);
  ticking a checkbox there forces that PR immediately and bypasses the schedule. That is the way to
  bleed off the backlog in controlled batches without editing the config.
- `minimumReleaseAge: '3 days'` + `internalChecksFilter: 'strict'` hold an update back entirely
  while a release is less than three days old, rather than falling through to an older version.

No flood risk: the config sets no `prConcurrentLimit` / `prHourlyLimit`, so Renovate's defaults
apply — 10 concurrent PRs, 2 created per hour.

### GitHub Pages source

- [x] `bun run repo:settings:apply --only pages` (sets the Pages source to GitHub Actions)
- **Unlocks:** `.github/workflows/docs.yml` publishing the VitePress site on every push to `main`.
- **Flip:** —
- **Proof:** `bun run repo:settings:check` reports no `pages.*` drift; the site loads.

## First real runs still owed

These lanes are written, validated (`eas workflow:validate`) and reviewed, but have never executed
against real infrastructure. Every **Unverified** callout in the docs points here. Record what the
first run teaches in the doc or ADR named in the last column — that is how a lane stops being
unverified.

| Lane                                    | Blocked on                                                                                                                                                           | What the first run must confirm                                                                                                               | Record in                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `E2E (native)` (`e2e.yml`)              | [Expo GitHub App](#link-the-expo-github-app)                                                                                                                         | Both `maestro_<p>` jobs start, the build id resolves through `after.*`, the PR comment shows flow counts, the a11y / Flashlight hooks execute | [native-e2e.md](native-e2e.md#workflow-easworkflowse2eyml)                            |
| `e2e:ios` label run                     | [Expo GitHub App](#link-the-expo-github-app)                                                                                                                         | A labelled run arrives as `pull_request` and the `comment` guard tolerates it                                                                 | [native-e2e.md → Tiered mode](native-e2e.md#tiered-mode)                              |
| `Preview web` (`preview-web.yml`)       | [EAS Hosting dev-domain](#claim-the-eas-hosting-dev-domain)                                                                                                          | The `pr-<n>` alias deploys and the PR comment lands                                                                                           | [release-ladder.md → PR previews](release-ladder.md#pr-previews-web-opt-in)           |
| `Promote` (`promote.yml`)               | a staging update group (one merge to `main` after the Expo GitHub App link)                                                                                          | `resolve` finds the group, the approval page renders, the republish keeps the group byte-for-byte                                             | [release-ladder.md → UAT and production](release-ladder.md#uat-and-production-manual) |
| `Release` (`release.yml`, both halves)  | [the first release](#cut-the-first-release) + [Apple](#apple-app-store-credentials-and-the-asc-api-key) / [Play](#google-play-first-aab-and-the-service-account-key) | The tag reaches the reviewer, the fingerprint short-circuit behaves, TestFlight / Play internal receive the build                             | [release-ladder.md → Store release](release-ladder.md#store-release-tag)              |
| `Rollout` (`rollout.yml`)               | a production rollout group                                                                                                                                           | `resolve` refuses the wrong group and the `update-rollout` job ramps the right one                                                            | [release-ladder.md → Staged rollouts](release-ladder.md#staged-rollouts-production)   |
| `Backport` (`backport.yml`)             | [a store release tag](#cut-the-first-release)                                                                                                                        | `git` in a custom job can fetch and cherry-pick, `bun install --frozen-lockfile` works on an old tree, the update's runtime version matches   | [ADR-0008](adr/0008-multi-runtime-ota-backports.md)                                   |
| `E2E (Maestro Cloud)` (`e2e-cloud.yml`) | [a Maestro Cloud plan](#maestro-cloud-real-device-farm)                                                                                                              | Job `env` reaches the flows as `${MAESTRO_APP_ID}`, `flows: .maestro` is accepted, whether a PR check appears                                 | [ADR-0006](adr/0006-maestro-cloud-optional-job.md)                                    |
| `Observe check`                         | a staging soak with real launches                                                                                                                                    | Observe reports data at all, then [re-base the budget](#re-base-the-observe-budget-on-real-data)                                              | [observe.md](observe.md)                                                              |

## Status in this repo

Delete this section in a project created from the template — it is `seandillon1224/expo-boilerplate`'s
own state, not yours (which is why `bun run init` leaves this file alone rather than rewriting it).
Last audited **2026-09-15** (`bun run repo:settings:check`, `gh secret list`, `gh pr list`).

Done: `bun run repo:settings:apply` — `repo:settings:check` reports a match across all five
sections (protection, repo, environments, labels, pages), so `Docs` is now enforced, a `v*` tag can
deploy `release.yml`, and `web-preview` exists. `EXPO_TOKEN` and `RELEASE_PLEASE_TOKEN` repository
secrets. Android keystores for all four application ids. Renovate out of Silent mode — Dependency
Dashboard #211 lists 25 updates awaiting the Monday schedule and 4 held by `minimumReleaseAge`.

Outstanding:

- **Merge release-please PR #136 (`chore(main): release 1.1.0`).** It is green on all 18 checks and
  rebased; the #184 changelog fix cleared it with no manual re-run needed. Merging tags `v1.1.0` and
  hands off to `release.yml` → EAS build → TestFlight, so it is also the first real exercise of the
  tag → `production` environment path that `--only environments` just unblocked. Check the App Store
  prerequisites below first — an ASC API key, the app record + `ascAppId`, and a TestFlight group
  named exactly `Internal` all gate the job that runs after the tag.
- Three native fingerprint bumps landed on 2026-09-14 (`expo-dev-client` added, `expo-image`
  removed, `ITSAppUsesNonExemptEncryption`), so a store release is required before the next
  production promotion. PR #136 is how you get one.
- Everything in [First real runs still owed](#first-real-runs-still-owed): no EAS workflow has run
  against GitHub, no staging update group exists, no `SLACK_WEBHOOK_URL` has ever been set.
- Decide whether `Bash(bunx --package renovate:*)` stays in `.claude/settings.json` — it has no call
  site in the repo.
