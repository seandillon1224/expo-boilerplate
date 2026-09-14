# JS gate: required checks

The JS gate is everything that can run without a simulator or native toolchain: GitHub Actions
runs it on every PR to `main` and every push to `main` (PLAN.md decision 1). Branch protection on
`main` requires every check below except `Perf (Reassure)` and `Fingerprint drift`, so a PR merges exactly when the
required set is green. The native lane (fingerprint → build → repack → Maestro on device → update)
runs in EAS Workflows (`.eas/workflows/e2e.yml`) and reports to the PR separately; see
[How EAS checks appear on the PR](#how-eas-checks-appear-on-the-pr).

## Checks

Check names are the job `name:` values in `.github/workflows/ci.yml` and `pr-title.yml`; that exact
string is what branch protection matches on. A third workflow, `release.yml`, is not a PR check: it runs on
a pushed `v*` tag, behind the `production` GitHub Environment, and only starts the EAS store
release ([release ladder](release-ladder.md#store-release-tag)). Durations are from a recent PR run
(`gh run view <id>`), wall-clock per job on `ubuntu-latest`; all jobs start in parallel except
`Maestro web`, which waits for `Bundle budget (web)` alone (that leg is its own job, separate from
the ios/android matrix, so the web E2E does not wait on the native exports).

| Check on the PR           | Workflow / job             | Runs                                                                                                                                         | Trigger          | Required | Artifacts                         | Typical duration                        |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- | --------------------------------- | --------------------------------------- |
| `Lint`                    | `CI` / `lint`              | `bun run lint` = `oxlint && expo lint` (oxlint defaults first, then ESLint for what oxlint cannot express; ADR-0004)                         | PR, push to main | yes      | –                                 | ~15 s                                   |
| `Typecheck`               | `CI` / `typecheck`         | `bun run typecheck`                                                                                                                          | PR, push to main | yes      | –                                 | ~15 s                                   |
| `Format`                  | `CI` / `format`            | `bun run format:check`                                                                                                                       | PR, push to main | yes      | –                                 | ~15 s                                   |
| `Knip`                    | `CI` / `knip`              | `bun run knip`                                                                                                                               | PR, push to main | yes      | –                                 | ~15 s                                   |
| `Env check`               | `CI` / `env-check`         | `bun run env:check`                                                                                                                          | PR, push to main | yes      | –                                 | ~15 s                                   |
| `i18n check`              | `CI` / `i18n-check`        | `bun run i18n:check`                                                                                                                         | PR, push to main | yes      | –                                 | ~15 s                                   |
| `Unit tests`              | `CI` / `unit`              | `bun run test:coverage`                                                                                                                      | PR, push to main | yes      | `junit`, `coverage`               | ~40 s                                   |
| `Commitlint`              | `CI` / `commitlint`        | `bunx commitlint --from <base> --to <head>` (PR) / pushed range (main)                                                                       | PR, push to main | yes      | –                                 | ~20 s                                   |
| `Secret scan`             | `CI` / `secret-scan`       | `gitleaks/gitleaks-action` with `.gitleaks.toml` (local: `bun run secrets:scan`)                                                             | PR, push to main | yes      | gitleaks SARIF (job summary)      | ~10 s                                   |
| `Bundle budget (web)`     | `CI` / `bundle-budget-web` | `bun run export:web && bun run budget --platform web`                                                                                        | PR, push to main | yes      | `bundle-sizes-web`, `web-export`  | ~75 s                                   |
| `Bundle budget (ios)`     | `CI` / `bundle-budget`     | `bun run export:ios && bun run budget --platform ios`                                                                                        | PR, push to main | yes      | `bundle-sizes-ios`                | ~55 s                                   |
| `Bundle budget (android)` | `CI` / `bundle-budget`     | `bun run export:android && bun run budget --platform android`                                                                                | PR, push to main | yes      | `bundle-sizes-android`            | ~45 s                                   |
| `Maestro web`             | `CI` / `maestro-web`       | `bun run serve:web` + `bun run e2e:web` against the `web-export` artifact                                                                    | PR, push to main | yes      | `maestro-web`                     | ~80 s, after `Bundle budget (web)` only |
| `Docs`                    | `CI` / `docs`              | `bun run docs:build`: VitePress build of `docs/`, red on any dead relative link                                                              | PR, push to main | yes      | –                                 | ~30 s                                   |
| `Template init`           | `CI` / `template-init`     | `bun run template:e2e`: headless `bun run init --fresh-git` on a copy of the checkout, then the gate on the generated project                | PR, push to main | yes      | –                                 | ~2 min                                  |
| `Perf (Reassure)`         | `CI` / `perf`              | `bun run perf:baseline` (base) → `bun run perf` (head) → `bun run perf:gate`                                                                 | PR only          | **no**   | `reassure`, report in job summary | ~50 s                                   |
| `Fingerprint drift`       | `CI` / `fingerprint-drift` | `node scripts/fingerprint.js` (`APP_VARIANT=production`) on base and head, then one upserted PR comment + `fingerprint-drift` label on drift | PR only          | **no**   | report in job summary             | ~45 s                                   |
| `PR title`                | `PR title` / `pr-title`    | `bunx commitlint` on the PR title                                                                                                            | PR only          | yes      | –                                 | ~20 s                                   |

Critical path is `Bundle budget (web)` → `Maestro web`, about 2 min 40 s from trigger to a fully
green PR. `Perf (Reassure)` is informational: it fails on a statistically significant slowdown
so the signal is visible, but it does not block merge (its run-to-run noise is too high to gate on
a single sample). `Fingerprint drift` is informational too and never red: it exists to post a PR
comment when the native fingerprint changes — merging then means a staging build and a store release
before production promotion ([release ladder](release-ladder.md#fingerprint-drift-on-prs-informational)).
`CI` sets `concurrency.cancel-in-progress` to "this is a pull request": pushing again to a PR
branch cancels the previous run for that ref, but a push to `main` never cancels the run of the
commit before it — back-to-back merges each keep their own green status.

`Template init` is the slowest job and runs in parallel with everything else, so it sets the time to
a fully green PR: it installs into a copy of the checkout, runs the documented headless
`bun run init --fresh-git` there (no EAS project id, no `EXPO_TOKEN`), then runs the same gate
(lint, typecheck, test, knip, i18n, format, env) on the generated project's first commit and fails
on any leftover template identifier outside `KEEP` — PLAN.md decision 4's definition of done
([template init](template-init.md#end-to-end-test)). It is removed by `bun run init`.

## How merging works

| Setting                                | Value                              | Why                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge method                           | squash only                        | Linear history on `main`; one ticket = one PR = one commit.                                                                                                                                                        |
| Squash commit subject                  | PR title                           | `squash_merge_commit_title: PR_TITLE`; the `PR title` check runs commitlint on it, and `Commitlint` lints every commit on the branch, so both the branch and the resulting `main` commit are Conventional Commits. |
| Squash commit body                     | PR body                            | `squash_merge_commit_message: PR_BODY`; keep `Closes #n` in the PR body so the issue closes on merge.                                                                                                              |
| Required status checks                 | every row marked "yes" above       | `Perf (Reassure)` and `Fingerprint drift` are excluded on purpose.                                                                                                                                                 |
| `strict` (up to date)                  | `false`                            | The queue pushes `chore(queue): ...` ledger commits straight to `main`; requiring branches to be up to date would force a rebase + full re-run on every PR after every ledger commit.                              |
| Required reviews                       | none                               | The automated queue merges as soon as CI is green; the required checks are the gate.                                                                                                                               |
| `enforce_admins`                       | `false`                            | Lets the repo owner push the ledger commits (which skip the PR flow) and unblock a stuck merge.                                                                                                                    |
| Linear history / force push / deletion | required / blocked / blocked       | Standard.                                                                                                                                                                                                          |
| Auto-merge                             | enabled (`allow_auto_merge: true`) | Needed for Renovate `platformAutomerge`.                                                                                                                                                                           |
| Delete branch on merge                 | `true`                             | Keeps the branch list at zero.                                                                                                                                                                                     |

Renovate path (`.github/renovate.json5`): dev-tooling minor/patch and GitHub Actions minor/patch/digest
updates open a PR with `automerge: true`, `automergeType: 'pr'`, `platformAutomerge: true`. Renovate
enables GitHub's native auto-merge on the PR, and GitHub squash-merges it the moment every required
check passes; nothing polls. Because the PR body is the squash message, Renovate PRs land as
`chore(deps): ...` commits (`:semanticCommits`).

What is deliberately **not** auto-merged:

- the `expo sdk` group (`expo`, `react`, `react-native`, `expo-**`, `@expo/**`, `react-native-**`,
  `@react-native/**`, `eslint-config-expo`, `jest-expo`) — these move together via
  `bunx expo install --fix`, not one at a time — and any major in that same list, which is
  `enabled: false` outright and goes through the expo-upgrade flow instead;
- majors of `oxlint` / `eslint-plugin-oxlint`, `vitepress` / `vitepress-plugin-mermaid` / `mermaid`,
  and `eas-cli`. Each of those groups is `matchUpdateTypes: ['minor', 'patch']`, so a major falls
  through to a plain un-auto-merged PR. `eas-cli` needs the carve-out because the `cli.version`
  floor in `eas.json` (`>= 23.0.0`) does not cap the major.

Every update also waits `minimumReleaseAge: '3 days'` with `internalChecksFilter: 'strict'`, so a
yanked or hotfixed release never reaches a PR (digest re-tags opt out at `0 days`).

Two pins have no native Renovate manager and are covered by `customManagers`:

| Pin             | Files                                                                                                                | Datasource                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Maestro CLI     | `maestro_version:` in `.eas/workflows/*.yml`, `MAESTRO_VERSION:` in `ci.yml`, `maestroPinned` in `scripts/doctor.js` | `github-releases` `mobile-dev-inc/Maestro` (`cli-*` tags) |
| Bun (EAS Build) | `build.base.bun` in `eas.json`                                                                                       | `github-releases` `oven-sh/bun` (`bun-v*` tags)           |

The Maestro manager matches all of those occurrences in one PR, so the pin only ever exists as a
single value — never bump one file by hand.

## Changing the required set

The required checks live in code, not in the GitHub UI:

1. Edit `REQUIRED_CHECKS` (or the rest of `DESIRED`) in `scripts/repo-settings.js`. A job that is
   deliberately not a gate goes in `INFORMATIONAL` in the same file instead: every job name in
   `ci.yml` and `pr-title.yml` must appear in one of the two lists (and nothing may be listed that
   no job produces), which `scripts/__tests__/repo-settings.test.ts` parses the workflows to check.
2. `bun run repo:settings` to preview the `gh api` calls (dry run, default).
3. `bun run repo:settings:apply` to `PUT` branch protection, `PATCH` repo settings, `PUT` the
   `uat` / `production` environments, upsert the labels and point GitHub Pages at Actions (needs
   `gh auth login` with admin on the repo; the script refuses to start otherwise).
4. `bun run repo:settings:check` to diff live state against `DESIRED`; it exits 1 on drift and
   lists every drifted field (`labels.needs-human.description: want ..., got ...`).

Every mode takes `--only <section>[,<section>]` to work on a subset of `protection`, `repo`,
`environments`, `labels`, `pages` — e.g. `bun run repo:settings:check --only labels` after adding a label,
or `--only protection` after renaming a job. The repo is whatever `gh repo view` resolves from the
`origin` remote (`GH_REPO=owner/name` overrides).

`DESIRED.labels` holds every label the automation adds or filters on — `epic:E*`, `in-progress`
and `needs-human` (`/ship-next`), `deep-dive`, `flaky-flow` + `e2e` (the flaky-flow issue
template), `e2e:ios` (`.eas/workflows/e2e.yml`), `e2e:cloud` (`.eas/workflows/e2e-cloud.yml`),
`fingerprint-drift` (the `Fingerprint drift`
job) and `dependencies` (Renovate) — with a color and description each. Apply creates missing
labels and patches a changed color or description; it never deletes a label it does not know
about, so GitHub's defaults and hand-made labels survive. New automation that adds a label goes
into `LABELS` first, then `bun run repo:settings:apply --only labels`.

`DESIRED.environments` holds the `uat` and `production` deployment environments: a required
reviewer (the repo owner) and a **deployment branch policy** listing
which refs may deploy. That list is `custom_branch_policies`, not "protected branches only":
`.github/workflows/release.yml` runs on `push` of a `v*` tag, and a tag ref is not a protected
branch, so the protected-branches setting made GitHub refuse the deployment before the reviewer
prompt ever appeared. Each environment therefore carries a `branch_policies` array of
`{ type: 'branch' | 'tag', name }` — `production` allows branch `main` **and** tag `v*`, `uat`
allows branch `main`. These are a separate API resource
(`/repos/{owner}/{repo}/environments/{env}/deployment-branch-policies`), so apply `PUT`s the
environment first, then `POST`s the policies it is missing and `DELETE`s ones that are not in
`DESIRED`; check reports them as
`environments.production.branch_policies: missing ["tag:v*"]`. `--only environments` covers both
the environment and its policies.

`DESIRED.pages` sets the repo's GitHub Pages source to GitHub Actions (`build_type: workflow`),
which `.github/workflows/docs.yml` needs to publish the docs site: apply `POST`s the Pages site
when there is none and `PUT`s the source when it points at a branch; check reports either.

Adding a job to `ci.yml` does not gate merge until its `name:` is in `REQUIRED_CHECKS` and the
script is re-applied. The reverse is the trap: **renaming a job's `name:` silently un-gates it**.
GitHub keeps requiring the old string, which no job reports any more, so the PR shows the old
context as "Expected — waiting for status" forever (merge blocked) or, if the old context is
removed, the renamed job is simply no longer required. There is no CI drift guard because the
Actions `GITHUB_TOKEN` cannot read branch protection; run `bun run repo:settings:check` after
touching workflow names or `repo-settings.js`.

To see what a PR is waiting on: `gh pr checks <n>` and
`gh pr view <n> --json mergeStateStatus -q .mergeStateStatus` (`CLEAN` = mergeable, `BLOCKED` =
a required context is missing or red).

## How EAS checks appear on the PR

> **Status: wired, not required.** `.eas/workflows/e2e.yml` (`E2E (native)`) runs on every PR to
> `main` and posts one PR comment per run. Its check context is deliberately **not** in
> `REQUIRED_CHECKS`: making it required needs the Expo GitHub App linked and one paid first run
> to read the exact context string from ([Owner checklist → Make `E2E (native)` a required
> check](owner-checklist.md#make-e2e-native-a-required-check)). How to do that is at the end of
> this section.

The native lane runs on EAS Workflows, not GitHub Actions: `fingerprint` → per platform
`get_build` (hit: `repack` this commit's JS into the cached base | miss: paid full `build`) →
`maestro` → `comment` ([Native E2E → Workflow](native-e2e.md#workflow-easworkflowse2eyml)). EAS
reports the run back to the PR through the Expo GitHub App, so it shows in the same Checks list
as the rows above and can be made a required check. Its exact context string is not pinned by
Expo's docs and is unknown until the first PR run.

What has to be true for the check to appear (from
[EAS Workflows: get started](https://docs.expo.dev/eas/workflows/get-started/) and
[Building from GitHub](https://docs.expo.dev/build/building-from-github/)):

| Requirement                                                                         | Where                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EAS project exists and is linked to this repo (`EAS_PROJECT_ID` in `app.config.ts`) | done ([environments and secrets](environments-and-secrets.md))                                                                                                                                    |
| Expo GitHub App installed on the repo and connected to the EAS project              | **human, once**: expo.dev → account → project → **GitHub** settings; the Expo user must have a linked GitHub account ([Native E2E → Human prerequisites](native-e2e.md#human-prerequisites-once)) |
| Workflow file with a GitHub trigger                                                 | `.eas/workflows/e2e.yml`: `on: pull_request: branches: [main]` plus `pull_request_labeled: [e2e:ios]` and `workflow_dispatch` (`push` is off by default)                                          |
| Workflow file present on the PR branch                                              | EAS reads `.eas/workflows/*.yml` from the triggering commit                                                                                                                                       |

Behaviour worth knowing before making it required:

- PRs from forks do **not** trigger `pull_request` EAS workflows. Fork PRs would then wait on a
  required EAS context forever; this template assumes same-repo branches.
- Commits containing `[eas skip]`, `[skip eas]` or `[no eas]` skip EAS runs; the same forever-wait
  applies, so don't use those markers on a PR that must merge.
- Fingerprint short-circuit (PLAN.md decision 2): when the native fingerprint is unchanged the
  workflow reuses an existing build via `get-build` and only repacks + tests, so the check is
  fast on JS-only PRs and slow (a real build) on native-affecting ones. The very first run has
  no cached base and cuts two paid builds.
- iOS is tiered by the `IOS_MODE` constant (`always` | `main-only` | `label`, see
  [Native E2E → Tiered mode](native-e2e.md#tiered-mode)); Android always runs. A tier that skips
  iOS on PRs still reports the check, with the iOS row marked skipped in the comment.
- Concurrency: a new push to the same branch cancels the run in flight, like `CI`.

To make it required, once the GitHub App is linked and the first PR run has reported:

1. Read the exact context string from `gh pr checks <n>` on that PR.
2. Add it, verbatim, to `REQUIRED_CHECKS` in `scripts/repo-settings.js`.
3. `bun run repo:settings:apply` (then `bun run repo:settings:check` to confirm no drift), as in
   [Changing the required set](#changing-the-required-set).

Until then `E2E (native)` is informational on the PR. The other EAS workflows are not PR checks:
`preview-web.yml` runs only on a PR labelled `web-preview` (opt-in, so the checks list carries no
permanent "skipped" entry while `HOSTING` is disabled) and only posts a comment;
`deploy-staging.yml` runs on `push` to `main`; `promote.yml`, `release.yml`,
`observe-check.yml` and `register-device.yml` are `workflow_dispatch` only
([CI overview → EAS Workflows](ci-overview.md#eas-workflows-easworkflows)).

## Running the gate locally

Same commands the jobs run, in the order that fails fastest:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && \
  bun run format:check && bun run env:check && bun run i18n:check
```

Then the slower ones as needed:

| Job               | Local command                                                                                                                    | Notes                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Commitlint        | runs on every commit via the lefthook `commit-msg` hook                                                                          | `bunx commitlint --from origin/main` to lint the whole branch                                                |
| Secret scan       | `bun run secrets:scan`                                                                                                           | Needs `gitleaks` on `PATH`.                                                                                  |
| Bundle budget     | `bun run export:web && bun run budget --platform web` (same for `ios`, `android`); bare `bun run budget` after all three exports | Exports go to `dist-<platform>/`, gitignored.                                                                |
| Maestro web       | `bun run serve:web` in one shell, `bun run e2e:web` in another                                                                   | Needs Maestro ≥ 2.9 (`curl -Ls https://get.maestro.mobile.dev \| bash`) and a JDK; report in `maestro-web/`. |
| Perf (Reassure)   | `bun run perf:baseline` on `main`, then `bun run perf` on your branch, then `bun run perf:gate`                                  | Report in `.reassure/output.md`.                                                                             |
| Fingerprint drift | `APP_VARIANT=production bun run fingerprint` on `main` and on your branch; compare                                               | `--debug` lists the sources behind a changed hash.                                                           |
| Docs              | `bun run docs:build`                                                                                                             | `bun run docs:dev` to browse; dead links are listed in the build output.                                     |
| Template init     | `bun run template:e2e`                                                                                                           | Copy in a temp dir, removed on success; `--keep` keeps it, `--dir <path>` picks where.                       |
| PR title          | `printf '%s\n' "your title" \| bunx commitlint`                                                                                  | Same config as the commit hook.                                                                              |

Lefthook already runs eslint/prettier on staged files at `pre-commit` and `typecheck` + `knip` at
`pre-push`, so a push that gets through the hooks usually passes the fast half of the gate.
