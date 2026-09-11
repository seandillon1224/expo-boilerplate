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

Headless (what the CI end-to-end test, #56, runs):

```sh
bun run init --yes --fresh-git \
  --name "Acme Mobile" --slug acme-mobile --scheme acme \
  --bundle-id com.acme.mobile --package com.acme.mobile \
  --owner acme-team --github-repo acme-inc/acme-mobile \
  --eas-project-id 11111111-2222-4333-8444-555555555555
```

Add `--dry-run` to print the per-file diff and the step summary without writing (or deleting)
anything. `--yes` skips the prompts and fills any missing flag from the derived defaults (folder
name → slug / name / scheme, OS user → Expo account, `com.<owner>.<scheme>` → bundle id and
package). Init starts with the [toolchain check](doctor.md) and stops before writing anything
when a required tool is missing; `--skip-doctor` skips it.

## Steps, in order

`scripts/init.js` exports `steps`, the ordered list of what init does; every step is dry-run
aware and reported in the closing summary.

| Step          | What it does                                                                                                                                                                                                                   | Opt out                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `doctor`      | [Toolchain check](doctor.md); a `MISSING` required tool aborts before anything is written                                                                                                                                      | `--skip-doctor`                                                 |
| `rewrite`     | Rewrites the identifiers listed under [What it rewrites](#what-it-rewrites), then runs prettier on the touched files                                                                                                           | —                                                               |
| `scan`        | Scans every tracked file for leftover template identifiers and prints them (warnings, never failures)                                                                                                                          | —                                                               |
| `ledger`      | Replaces `.claude/execution-queue.md` with an empty ledger: same legend and rule, tracker = your GitHub repo, empty `OPEN QUEUE`, a run log with the init line — so `/ship-next` works from day one                            | —                                                               |
| `plan`        | Replaces `PLAN.md` with a stub: the template's **Locked decisions** table kept verbatim (`CLAUDE.md` and `docs/` cite "PLAN.md decision N" by number) plus a link to the upstream plan for the rest                            | `--keep-plan`                                                   |
| `changelog`   | Replaces `CHANGELOG.md` with a fresh header when the template ships one (it does not yet; release-please is #60), otherwise notes "no CHANGELOG.md, skipped"                                                                   | —                                                               |
| `self-delete` | Removes init: see [What it deletes](#what-it-deletes)                                                                                                                                                                          | `--keep-init`                                                   |
| `fresh-git`   | `rm -rf .git`, `git init -b main`, one commit `chore: initialize <slug> from expo-boilerplate` of the final tree, then `bunx lefthook install` (the hooks went with the old `.git`); prints the `git remote add origin …` hint | on only with `--fresh-git` (interactive prompt, default **No**) |

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

| Flag               | What it sets                                                                                                  | Validation                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `--name`           | Display name (`app.config.ts` `BASE.name`; variants append ` (Dev)` / ` (Staging)` / ` (UAT)`), README title  | non-empty, no quotes                      |
| `--slug`           | Expo slug, `package.json` name, EAS Hosting dev-domain, query-cache key, gitleaks title                       | `^[a-z0-9]+(-[a-z0-9]+)*$`                |
| `--scheme`         | URL scheme (variants append `-dev` / `-staging` / `-uat`)                                                     | lowercase, starts with a letter           |
| `--bundle-id`      | iOS bundle identifier (production; variants append `.dev` / `.staging` / `.uat`)                              | reverse-DNS                               |
| `--package`        | Android application id (usually equal to the bundle id; Android forbids dashes)                               | reverse-DNS, segments start with a letter |
| `--owner`          | Expo account: `expo.dev/accounts/<owner>/projects/<slug>` links in workflow Slack / PR messages and docs      | letters, digits, dashes                   |
| `--github-repo`    | `owner/name`: README badge URLs, docs, and the `uat` / `production` environment reviewer in `repo-settings`   | `owner/name`                              |
| `--eas-project-id` | `EAS_PROJECT_ID` in `app.config.ts` (`extra.eas.projectId` + `updates.url`)                                   | UUID, or empty (see below)                |
| `--fresh-git`      | Replace the git history with one initial commit (prompted interactively, default No; never under `--dry-run`) | refuses a dirty working tree              |
| `--keep-init`      | Keep `scripts/init.js`, its test and this doc (default: self-delete)                                          | —                                         |
| `--keep-plan`      | Keep `PLAN.md` untouched (default: stub with the inherited decisions)                                         | —                                         |

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
`plan` step; the stub links upstream), the upstream research-issue link in `docs/performance.md`,
and the init script plus its test (they carry the template identity they match on, and are
removed by the `self-delete` step anyway).

Then run the gate — it must pass on the first commit:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check
bunx expo config --type public   # sanity-check the rebranded app config
```

## Left for the sibling tickets

The next tickets append to `steps` rather than growing the rewrite step:

- **#55** `bun run repo:settings:apply` + labels — until then run it by hand after pushing.
- **#56** CI end-to-end test of the template: headless init on a fresh copy, then the JS gate.
