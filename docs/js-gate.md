# JS gate: required checks

The JS gate is everything that can run without a simulator or native toolchain: GitHub Actions
runs it on every PR to `main` and every push to `main` (PLAN.md decision 1). Branch protection on
`main` requires every check below except `Perf (Reassure)`, so a PR merges exactly when the
required set is green. The native lane (fingerprint → build → repack → Maestro on device → update)
runs in EAS Workflows and is wired in E4; see [How EAS checks appear on the PR](#how-eas-checks-appear-on-the-pr-wired-in-e4).

## Checks

Check names are the job `name:` values in `.github/workflows/ci.yml` and `pr-title.yml`; that exact
string is what branch protection matches on. A third workflow, `release.yml`, is not a PR check: it runs on
a pushed `v*` tag, behind the `production` GitHub Environment, and only starts the EAS store
release ([release ladder](release-ladder.md#store-release-tag)). Durations are from a recent PR run
(`gh run view <id>`), wall-clock per job on `ubuntu-latest`; all jobs start in parallel except
`Maestro web`.

| Check on the PR           | Workflow / job          | Runs                                                                             | Trigger          | Required | Artifacts                         | Typical duration                           |
| ------------------------- | ----------------------- | -------------------------------------------------------------------------------- | ---------------- | -------- | --------------------------------- | ------------------------------------------ |
| `Lint`                    | `CI` / `lint`           | `bun run lint`                                                                   | PR, push to main | yes      | –                                 | ~15 s                                      |
| `Typecheck`               | `CI` / `typecheck`      | `bun run typecheck`                                                              | PR, push to main | yes      | –                                 | ~15 s                                      |
| `Format`                  | `CI` / `format`         | `bun run format:check`                                                           | PR, push to main | yes      | –                                 | ~15 s                                      |
| `Knip`                    | `CI` / `knip`           | `bun run knip`                                                                   | PR, push to main | yes      | –                                 | ~15 s                                      |
| `Env check`               | `CI` / `env-check`      | `bun run env:check`                                                              | PR, push to main | yes      | –                                 | ~15 s                                      |
| `i18n check`              | `CI` / `i18n-check`     | `bun run i18n:check`                                                             | PR, push to main | yes      | –                                 | ~15 s                                      |
| `Unit tests`              | `CI` / `unit`           | `bun run test:coverage`                                                          | PR, push to main | yes      | `junit`, `coverage`               | ~40 s                                      |
| `Commitlint`              | `CI` / `commitlint`     | `bunx commitlint --from <base> --to <head>` (PR) / pushed range (main)           | PR, push to main | yes      | –                                 | ~20 s                                      |
| `Secret scan`             | `CI` / `secret-scan`    | `gitleaks/gitleaks-action` with `.gitleaks.toml` (local: `bun run secrets:scan`) | PR, push to main | yes      | gitleaks SARIF (job summary)      | ~10 s                                      |
| `Bundle budget (web)`     | `CI` / `bundle-budget`  | `bun run export:web && bun run budget:web`                                       | PR, push to main | yes      | `bundle-sizes-web`, `web-export`  | ~75 s                                      |
| `Bundle budget (ios)`     | `CI` / `bundle-budget`  | `bun run export:ios && bun run budget:ios`                                       | PR, push to main | yes      | `bundle-sizes-ios`                | ~55 s                                      |
| `Bundle budget (android)` | `CI` / `bundle-budget`  | `bun run export:android && bun run budget:android`                               | PR, push to main | yes      | `bundle-sizes-android`            | ~45 s                                      |
| `Maestro web`             | `CI` / `maestro-web`    | `bun run serve:web` + `bun run e2e:web` against the `web-export` artifact        | PR, push to main | yes      | `maestro-web`                     | ~80 s, after all three `Bundle budget (*)` |
| `Perf (Reassure)`         | `CI` / `perf`           | `bun run perf:baseline` (base) → `bun run perf` (head) → `bun run perf:gate`     | PR only          | **no**   | `reassure`, report in job summary | ~50 s                                      |
| `PR title`                | `PR title` / `pr-title` | `bunx commitlint` on the PR title                                                | PR only          | yes      | –                                 | ~20 s                                      |

Critical path is `Bundle budget (web)` → `Maestro web`, about 2 min 40 s from trigger to a fully
green PR. `Perf (Reassure)` is informational: it fails on a statistically significant slowdown
so the signal is visible, but it does not block merge (its run-to-run noise is too high to gate on
a single sample). `CI` uses `concurrency: cancel-in-progress`, so pushing again cancels the
previous run for the same ref.

## How merging works

| Setting                                | Value                              | Why                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Merge method                           | squash only                        | Linear history on `main`; one ticket = one PR = one commit.                                                                                                                                                        |
| Squash commit subject                  | PR title                           | `squash_merge_commit_title: PR_TITLE`; the `PR title` check runs commitlint on it, and `Commitlint` lints every commit on the branch, so both the branch and the resulting `main` commit are Conventional Commits. |
| Squash commit body                     | PR body                            | `squash_merge_commit_message: PR_BODY`; keep `Closes #n` in the PR body so the issue closes on merge.                                                                                                              |
| Required status checks                 | the 14 rows marked "yes" above     | `Perf (Reassure)` is excluded on purpose.                                                                                                                                                                          |
| `strict` (up to date)                  | `false`                            | The queue pushes `chore(queue): ...` ledger commits straight to `main`; requiring branches to be up to date would force a rebase + full re-run on every PR after every ledger commit.                              |
| Required reviews                       | none                               | The automated queue merges as soon as CI is green; the required checks are the gate.                                                                                                                               |
| `enforce_admins`                       | `false`                            | Lets the repo owner push the ledger commits (which skip the PR flow) and unblock a stuck merge.                                                                                                                    |
| Linear history / force push / deletion | required / blocked / blocked       | Standard.                                                                                                                                                                                                          |
| Auto-merge                             | enabled (`allow_auto_merge: true`) | Needed for Renovate `platformAutomerge`.                                                                                                                                                                           |
| Delete branch on merge                 | `true`                             | Keeps the branch list at zero.                                                                                                                                                                                     |

Renovate path (`.github/renovate.json5`): dev-tooling minor/patch and GitHub Actions minor/patch/digest
updates open a PR with `automerge: true`, `automergeType: 'pr'`, `platformAutomerge: true`. Renovate
enables GitHub's native auto-merge on the PR, and GitHub squash-merges it the moment every required
check passes; nothing polls. The `expo sdk` group and any Expo/React Native major are never
auto-merged. Because the PR body is the squash message, Renovate PRs land as `chore(deps): ...`
commits (`:semanticCommits`).

## Changing the required set

The required checks live in code, not in the GitHub UI:

1. Edit `REQUIRED_CHECKS` (or the rest of `DESIRED`) in `scripts/repo-settings.js`.
2. `bun run repo:settings` to preview the `gh api` calls (dry run, default).
3. `bun run repo:settings:apply` to `PUT` branch protection and `PATCH` repo settings (needs
   `gh auth login` with admin on the repo).
4. `bun run repo:settings:check` to diff live state against `DESIRED`; it exits 1 on drift.

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

## How EAS checks appear on the PR (wired in E4)

> **Status: not wired yet.** E4 (#35) adds `.eas/workflows/e2e.yml`. Nothing under `.eas/`
> exists on `main` today, and no EAS context is in `REQUIRED_CHECKS`. This section records what
> Expo's docs promise so E4 can slot in without re-deciding anything.

The native lane runs on EAS Workflows, not GitHub Actions. EAS reports the run back to the PR
through the Expo GitHub App, so it shows in the same Checks list as the rows above and can be
made a required check.

What has to be true for that to work (from
[EAS Workflows: get started](https://docs.expo.dev/eas/workflows/get-started/) and
[Building from GitHub](https://docs.expo.dev/build/building-from-github/)):

| Requirement                                                                                | Where                                                                                                                 |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| EAS project exists and is linked to this repo (`eas init`, `projectId` in `app.config.ts`) | E3 / E4                                                                                                               |
| Expo GitHub App installed on the repo and connected to the EAS project                     | expo.dev → account → project → **GitHub** settings; the Expo user must have a linked GitHub account                   |
| Workflow file with a GitHub trigger                                                        | `.eas/workflows/e2e.yml` with `on: pull_request: branches: [main]` (and `push: branches: [main]` for the staging OTA) |
| Workflow file present on the PR branch                                                     | EAS reads `.eas/workflows/*.yml` from the triggering commit, so a PR that adds the file triggers it                   |

Behaviour worth knowing before making it required:

- PRs from forks do **not** trigger `pull_request` EAS workflows. Fork PRs would then wait on a
  required EAS context forever; this template assumes same-repo branches.
- Commits containing `[eas skip]`, `[skip eas]` or `[no eas]` skip EAS runs; the same forever-wait
  applies, so don't use those markers on a PR that must merge.
- Fingerprint short-circuit (PLAN.md decision 2): when the native fingerprint is unchanged the
  workflow reuses an existing build via `get-build` and only repacks + tests, so the check is
  fast on JS-only PRs and slow (a real build) on native-affecting ones.
- Check naming: Expo's docs do not pin the check-run string; EAS reports the workflow (and, in
  the checks detail, links to the run on expo.dev). After E4's first PR run, read the exact
  context from `gh pr checks <n>` and put that string, verbatim, into `REQUIRED_CHECKS`, then
  `bun run repo:settings:apply`. Until then, the EAS check is informational on the PR.

E4's ticket owns adding the `e2e` context to the required set. Later E5 workflows (`update`,
`require-approval`, `submit`) run on `push` to `main` and via `workflow_dispatch` and are not PR
checks.

## Running the gate locally

Same commands the jobs run, in the order that fails fastest:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && \
  bun run format:check && bun run env:check && bun run i18n:check
```

Then the slower ones as needed:

| Job             | Local command                                                                                                    | Notes                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Commitlint      | runs on every commit via the lefthook `commit-msg` hook                                                          | `bunx commitlint --from origin/main` to lint the whole branch                                                |
| Secret scan     | `bun run secrets:scan`                                                                                           | Needs `gitleaks` on `PATH`.                                                                                  |
| Bundle budget   | `bun run export:web && bun run budget:web` (same for `ios`, `android`); `bun run budget` after all three exports | Exports go to `dist-<platform>/`, gitignored.                                                                |
| Maestro web     | `bun run serve:web` in one shell, `bun run e2e:web` in another                                                   | Needs Maestro ≥ 2.9 (`curl -Ls https://get.maestro.mobile.dev \| bash`) and a JDK; report in `maestro-web/`. |
| Perf (Reassure) | `bun run perf:baseline` on `main`, then `bun run perf` on your branch, then `bun run perf:gate`                  | Report in `.reassure/output.md`.                                                                             |
| PR title        | `printf '%s\n' "your title" \| bunx commitlint`                                                                  | Same config as the commit hook.                                                                              |

Lefthook already runs eslint/prettier on staged files at `pre-commit` and `typecheck` + `knip` at
`pre-push`, so a push that gets through the hooks usually passes the fast half of the gate.
