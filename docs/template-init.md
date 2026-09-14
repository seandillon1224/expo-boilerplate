# Template init (`bun run init`)

`bun run init` turns a fresh copy of this template into your app: it rewrites every place the
template's own identity is hardcoded, resets the queue ledger and `PLAN.md`, removes itself, and
(if you say yes) starts a fresh git history with one commit. Run it once, right after "Use this
template" / `git clone`, before the first commit (PLAN.md decision 4).

```sh
bun install
bun run doctor          # toolchain check: Bun / Node / git / EAS / gh / Maestro / Xcode / Android / Java
bun run init            # interactive; defaults derived from the folder name
```

Headless (exactly what the [end-to-end test](#end-to-end-test) runs, with no EAS project yet):

```sh
bun run init --yes --skip-doctor --fresh-git \
  --name "Acme Mobile" --slug acme-mobile --scheme acme \
  --bundle-id com.acme.mobile --package com.acme.mobile \
  --owner acme-team --github-repo acme-inc/acme-mobile \
  --eas-project-id=
```

Add `--dry-run` to print the per-file diff and the step summary without writing (or deleting)
anything. `--yes` skips the prompts and fills any missing flag from the derived defaults (folder
name → slug / name / scheme, OS user → Expo account, `com.<owner>.<scheme>` → bundle id and
package). Init starts with the [toolchain check](doctor.md) and stops before writing anything
when a required tool is missing; `--skip-doctor` skips it.

## Steps, in order

`scripts/init.js` exports `steps`, the ordered list of what init does; every step is dry-run
aware and reported in the closing summary.

| Step            | What it does                                                                                                                                                                                                                                                                                                                                                                                   | Opt out                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `doctor`        | [Toolchain check](doctor.md); a `MISSING` required tool aborts before anything is written                                                                                                                                                                                                                                                                                                      | `--skip-doctor`                                                                                    |
| `rewrite`       | Rewrites the identifiers listed under [What it rewrites](#what-it-rewrites), then runs prettier on the touched files                                                                                                                                                                                                                                                                           | —                                                                                                  |
| `scan`          | Scans every tracked file for leftover template identifiers and prints them (warnings, never failures)                                                                                                                                                                                                                                                                                          | —                                                                                                  |
| `ledger`        | Replaces `.claude/execution-queue.md` with an empty ledger: same legend and rule, tracker = your GitHub repo, empty `OPEN QUEUE`, a run log with the init line — so `/ship-next` works from day one                                                                                                                                                                                            | —                                                                                                  |
| `plan`          | Replaces `PLAN.md` with a stub: the template's **Locked decisions** table kept verbatim (`CLAUDE.md` and `docs/` cite "PLAN.md decision N" by number) plus a link to the upstream plan for the rest                                                                                                                                                                                            | `--keep-plan`                                                                                      |
| `changelog`     | Replaces `CHANGELOG.md` with a fresh header when the template ships one (release-please writes it on the template's first release), otherwise notes "no CHANGELOG.md, skipped"                                                                                                                                                                                                                 | —                                                                                                  |
| `versioning`    | Starts the project at `1.0.0` whatever the template has released: resets `.release-please-manifest.json` and `package.json` `version` (which `app.config.ts` reads), and in `release-please-config.json` points `last-release-sha` at the current HEAD (inherited history is never released retroactively) or drops it under `--fresh-git` ([ADR-0002](adr/0002-release-please-versioning.md)) | —                                                                                                  |
| `self-delete`   | Removes init: see [What it deletes](#what-it-deletes)                                                                                                                                                                                                                                                                                                                                          | `--keep-init`                                                                                      |
| `fresh-git`     | `rm -rf .git`, `git init -b main`, one commit `chore: initialize <slug> from expo-boilerplate` of the final tree, then `bunx lefthook install` (the hooks went with the old `.git`); prints the `git remote add origin …` hint                                                                                                                                                                 | on only with `--fresh-git` (interactive prompt, default **No**)                                    |
| `repo-settings` | Runs `bun run repo:settings:apply` ([JS gate](js-gate.md#changing-the-required-set)): `main` branch protection, squash-only merge settings, the `uat` / `production` environments and the automation's labels, via `gh`. Skipped with the manual command when `gh` is not logged in or there is no `origin` remote (always the case right after `--fresh-git`)                                 | on only with `--apply-repo-settings` (interactive prompt, default **No**; never under `--dry-run`) |

`.claude/skills/ship-next` and `.claude/settings.json` are kept as they are. Without
`--fresh-git` the old history stays and init prints the recommended first commit
(`git add -A && git commit -m "chore: initialize <slug> from expo-boilerplate"`).

`--fresh-git` refuses to run — before anything is written — when `git status --porcelain` shows
uncommitted changes, so it never swallows work that is not init's own; commit or stash first. It
never runs under `--dry-run`.

## What it deletes

The self-delete manifest is `REMOVAL` in `scripts/init.js`; like the rewrite manifest, every
entry must match on `main` (the drift guard in `scripts/__tests__/init.test.ts` checks it).

- `scripts/init.js`, `scripts/__tests__/init.test.ts`, this doc
- the `init` script in `package.json`
- the `bun run init` quick-start line and the "Template init" docs entry in `README.md`
- the `bun run init` command bullet in `CLAUDE.md`, and the "Also the first `init` step" note on
  the `bun run doctor` bullet (also in `docs/doctor.md`)

`bun run doctor`, `scripts/doctor.js`, its test and `docs/doctor.md` stay: they are useful in
the project. Comments in `app.config.ts`, the workflows and a few docs that say "`bun run init`
rewrites this" are left as history. `knip.jsonc` has no init-specific entry, so nothing changes
there; the gate (`lint`, `typecheck`, `test`, `knip`, `i18n:check`, `format:check`) passes on
the generated project — `scripts/__tests__/init.test.ts` proves it on a temp copy.

## Flags

| Flag                    | What it sets                                                                                                       | Validation                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `--name`                | Display name (`app.config.ts` `BASE.name`; variants append ` (Dev)` / ` (Staging)` / ` (UAT)`), README title       | non-empty, no quotes                             |
| `--slug`                | Expo slug, `package.json` name, EAS Hosting dev-domain, query-cache key, gitleaks title                            | `^[a-z0-9]+(-[a-z0-9]+)*$`                       |
| `--scheme`              | URL scheme (variants append `-dev` / `-staging` / `-uat`)                                                          | lowercase, starts with a letter                  |
| `--bundle-id`           | iOS bundle identifier (production; variants append `.dev` / `.staging` / `.uat`)                                   | reverse-DNS                                      |
| `--package`             | Android application id (usually equal to the bundle id; Android forbids dashes)                                    | reverse-DNS, segments start with a letter        |
| `--owner`               | Expo account: `expo.dev/accounts/<owner>/projects/<slug>` links in workflow Slack / PR messages and docs           | letters, digits, dashes                          |
| `--github-repo`         | `owner/name`: README badge URLs, docs, and the `uat` / `production` environment reviewer in `repo-settings`        | `owner/name`                                     |
| `--eas-project-id`      | `EAS_PROJECT_ID` in `app.config.ts` (`extra.eas.projectId` + `updates.url`)                                        | UUID, or empty (see below)                       |
| `--fresh-git`           | Replace the git history with one initial commit (prompted interactively, default No; never under `--dry-run`)      | refuses a dirty working tree                     |
| `--keep-init`           | Keep `scripts/init.js`, its test and this doc (default: self-delete)                                               | —                                                |
| `--keep-plan`           | Keep `PLAN.md` untouched (default: stub with the inherited decisions)                                              | —                                                |
| `--apply-repo-settings` | Run `bun run repo:settings:apply` as the last step (prompted interactively, default No; skipped under `--dry-run`) | needs `gh auth status` ok and an `origin` remote |

**No EAS project yet?** Pass `--eas-project-id=` (the `=` form: `bun run` drops an empty `""`
argument) or accept the empty prompt default.
`app.config.ts` then omits `updates.url` / `extra.eas.projectId` and disables updates, so
`expo config`, the JS gate and local dev still work; EAS Build / Update / Observe and the
workflows stay unlinked until you run `bun run eas init` and paste the id into `EAS_PROJECT_ID`.

## What it rewrites

The manifest lives in `scripts/init.js` (`buildManifest`). Every entry is a file plus the
patterns expected there; a pattern that matches fewer times than expected aborts the run before
anything is written, and `scripts/__tests__/init.test.ts` runs the same manifest against the
checked-in files on every PR (the drift guard), so moving an identifier without updating the
manifest fails CI.

| File                                                                         | Rewritten                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `app.config.ts`                                                              | `BASE.name` / `slug` / `scheme` / `bundleId` / `androidPackage`, `EAS_PROJECT_ID`, the `@owner/slug` comment |
| `package.json`                                                               | `name`                                                                                                       |
| `README.md`, `CLAUDE.md`                                                     | H1 title; README CI badge URLs                                                                               |
| `.gitleaks.toml`                                                             | `title`                                                                                                      |
| `src/lib/query-client.ts`                                                    | persisted query-cache key                                                                                    |
| `scripts/repo-settings.js`                                                   | `uat` / `production` environment reviewer login (= the GitHub repo owner; change if it is an org)            |
| `.maestro/config.yaml`                                                       | the `MAESTRO_APP_ID` example                                                                                 |
| `.eas/workflows/e2e.yml`, `e2e-quarantine.yml`                               | `MAESTRO_APP_ID` (bundle id on the iOS job, package on the Android job)                                      |
| `.eas/workflows/e2e.yml`, `deploy-staging.yml`, `promote.yml`, `release.yml` | `expo.dev/accounts/<owner>/projects/<slug>` links                                                            |
| `docs/*.md`                                                                  | bundle id / package examples, credentials table, dev-domain, staging web URL, expo.dev and GitHub links      |

Afterwards the script scans every tracked file for leftover template identifiers and prints what
it found. Some are kept on purpose (`KEEP` in `scripts/init.js`): `PLAN.md` (stubbed by the
`plan` step; the stub links upstream), the upstream issue links in `docs/performance.md` and under
"Commonly added next" in `README.md`, and the init script plus its test (they carry the template identity they match on, and are
removed by the `self-delete` step anyway).

Then run the gate — it must pass on the first commit:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check
bunx expo config --type public   # sanity-check the rebranded app config
```

Once the repo is on GitHub, `bun run repo:settings:apply` (or `bun run init --apply-repo-settings`
when `origin` already points there) pushes branch protection, merge settings, environments and
labels; `bun run repo:settings:check` shows drift afterwards. If the GitHub owner is an
organization, first change the `uat` / `production` reviewer in `scripts/repo-settings.js` to a
member login or a team (`{ type: 'Team', login: 'org/team-slug' }`) — organizations cannot review
deployments, and apply says so.

## End-to-end test

`bun run template:e2e` (`scripts/template-e2e.js`) is the proof of PLAN.md decision 4's definition
of done — "`bun run init` on a fresh copy produces a project whose JS gate passes on its first
commit" — and the `Template init` job in `.github/workflows/ci.yml` runs it on every PR and push
to `main` (required check, [JS gate](js-gate.md)). It never touches this checkout; everything
happens in a throwaway copy:

1. Copies the working tree (tracked and untracked files, nothing ignored) to a temp dir and makes
   one snapshot commit, so `--fresh-git` sees a clean tree.
2. `bun install --frozen-lockfile` there (the rewrite step runs prettier).
3. Runs the headless command above with no `EXPO_TOKEN` in the environment: init must not need
   EAS, and nothing may touch the network.
4. Asserts `bun.lock` is byte-identical to the template's, the history is exactly one commit on
   `main` with the `chore: initialize acme-mobile from expo-boilerplate` subject (checked with
   `bunx commitlint --last`), the tree is clean, every `REMOVAL` entry is gone, and
   `bun install --frozen-lockfile` is still a no-op against the rewritten `package.json`.
5. Runs the gate in the copy: `lint`, `typecheck`, `test`, `knip`, `i18n:check`, `format:check`,
   `env:check`, `docs:build` (the docs site still builds without this page: its sidebar entry and
   the links to it are dropped by `docs/.vitepress/config.mts` when the file is gone).
6. `bunx expo config --type public` with `APP_VARIANT=production` resolves the new name, slug,
   scheme, bundle id and package, with no `extra.eas` / `updates.url` (empty project id).
7. Scans every tracked file with the same `scanLeftovers` init uses and **fails** on any template
   identifier outside `KEEP` (init itself only warns). `bun.lock` keeps its `"name":
"expo-boilerplate"` root entry (Bun never rewrites it and it is not consulted by
   `--frozen-lockfile`), which is why the scan skips the lockfile.
8. Checks `git status --porcelain` of this checkout is exactly what it was before.

The copy is removed on success and kept (path printed) on failure; `--keep` always keeps it and
`--dir <path>` chooses where. About 30 s locally and a couple of minutes in CI (two installs plus the full gate
on the copy); no native toolchain, no EAS credits. The script is in the self-delete manifest, as
are the `template:e2e` package script, the `Template init` job, its `REQUIRED_CHECKS` entry and
the `docs/js-gate.md` rows: none of them make sense once the project is no longer the template.
