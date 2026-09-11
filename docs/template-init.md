# Template init (`bun run init`)

`bun run init` turns a fresh copy of this template into your app: it rewrites every place the
template's own identity is hardcoded and leaves everything else alone. Run it once, right after
"Use this template" / `git clone`, before the first commit (PLAN.md decision 4).

```sh
bun install
bun run doctor          # toolchain check: Bun / Node / git / EAS / gh / Maestro / Xcode / Android / Java
bun run init            # interactive; defaults derived from the folder name
```

Headless (what the CI end-to-end test, #56, runs):

```sh
bun run init --yes \
  --name "Acme Mobile" --slug acme-mobile --scheme acme \
  --bundle-id com.acme.mobile --package com.acme.mobile \
  --owner acme-team --github-repo acme-inc/acme-mobile \
  --eas-project-id 11111111-2222-4333-8444-555555555555
```

Add `--dry-run` to print the per-file diff and the summary table without writing. `--yes` skips
the prompts and fills any missing flag from the derived defaults (folder name → slug / name /
scheme, OS user → Expo account, `com.<owner>.<scheme>` → bundle id and package). Init starts
with the [toolchain check](#toolchain-check) and stops before writing anything when a required
tool is missing; `--skip-doctor` skips it.

## Flags

| Flag               | What it sets                                                                                                 | Validation                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `--name`           | Display name (`app.config.ts` `BASE.name`; variants append ` (Dev)` / ` (Staging)` / ` (UAT)`), README title | non-empty, no quotes                      |
| `--slug`           | Expo slug, `package.json` name, EAS Hosting dev-domain, query-cache key, gitleaks title                      | `^[a-z0-9]+(-[a-z0-9]+)*$`                |
| `--scheme`         | URL scheme (variants append `-dev` / `-staging` / `-uat`)                                                    | lowercase, starts with a letter           |
| `--bundle-id`      | iOS bundle identifier (production; variants append `.dev` / `.staging` / `.uat`)                             | reverse-DNS                               |
| `--package`        | Android application id (usually equal to the bundle id; Android forbids dashes)                              | reverse-DNS, segments start with a letter |
| `--owner`          | Expo account: `expo.dev/accounts/<owner>/projects/<slug>` links in workflow Slack / PR messages and docs     | letters, digits, dashes                   |
| `--github-repo`    | `owner/name`: README badge URLs, docs, and the `uat` / `production` environment reviewer in `repo-settings`  | `owner/name`                              |
| `--eas-project-id` | `EAS_PROJECT_ID` in `app.config.ts` (`extra.eas.projectId` + `updates.url`)                                  | UUID, or empty (see below)                |

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
it found. Some are kept on purpose (`KEEP` in `scripts/init.js`): `PLAN.md` (the template's
design document), the upstream research-issue link in `docs/performance.md`, and the init script
plus its test (they carry the template identity they match on).

Then run the gate — it must pass on the first commit:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check
bunx expo config --type public   # sanity-check the rebranded app config
```

## Toolchain check

`bun run doctor` (`scripts/doctor.js`) checks the tools this template needs, prints one row per
tool — status, the version found, the version expected — and, for every row that is not `ok`, the
exact install command (Homebrew on macOS; Linux where it differs). It is also the first `init`
step (`--skip-doctor` to skip). No network access except `eas whoami`.

| Check             | Expected (source)                                                                        | Required | Lane it unlocks                            |
| ----------------- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| **Bun**           | `>= 1.2.0` — `bun.lock` is a text lockfile (`saveTextLockfile` in `bunfig.toml`)         | yes      | everything                                 |
| Lockfiles         | only `bun.lock`; warns on `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`           | —        | Bun-only installs                          |
| **Node**          | major of `.node-version` (22)                                                            | yes      | scripts, lefthook, eas-cli                 |
| **git**           | `>= 2.28`                                                                                | yes      | everything                                 |
| lefthook hooks    | `.git/hooks/pre-commit` written by lefthook (`bunx lefthook install`, runs on `prepare`) | —        | pre-commit / commit-msg / pre-push hooks   |
| EAS CLI           | major of `eas-cli` in `package.json`, resolved via `bun run eas --version`               | —        | EAS build / update / workflows, `env:pull` |
| EAS login         | `bun run eas whoami --non-interactive` succeeds, or `EXPO_TOKEN` is set                  | —        | `e2e:build`, `env:pull`, `devices:*`       |
| GitHub CLI + auth | `gh` installed, `gh auth status` logged in                                               | —        | `repo:settings:*`                          |
| Maestro           | `>= 2.9.0`; CI pins `2.10.0` (`ci.yml`, `.eas/workflows/e2e.yml`); `~/.maestro/bin` ok   | —        | `e2e:web`, `e2e:ios`, `e2e:android`        |
| Xcode             | `>= 16.0` + at least one iOS simulator; macOS only (`skip` elsewhere)                    | —        | iOS lane                                   |
| Android SDK       | `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) exists, `adb` and `emulator` resolvable           | —        | Android lane                               |
| Java              | JDK `>= 17` — what the Maestro CLI and `@expo/repack-app`'s build-tools need             | —        | Maestro, Android repack                    |

Statuses: `ok`, `warn` (missing / incompatible / logged out, but only an optional lane is
affected), `MISSING` (a required tool — Bun, Node, git — is absent or incompatible), `skip` (not
applicable on this platform, or depends on a row that is not `ok`).

Flags and exit codes:

| Invocation                | Exit 1 when                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `bun run doctor`          | a required tool is `MISSING`; warnings exit 0               |
| `bun run doctor --strict` | any `MISSING` **or** `warn` (CI, #56); `skip` never fails   |
| `bun run doctor --json`   | same rules; prints `{ rows, summary }` instead of the table |

The expected versions live in one `EXPECTED` constant at the top of `scripts/doctor.js`, each
with the reason for the number; `scripts/__tests__/doctor.test.ts` drives every check with a fake
`run()` so the tests never touch a real binary.

## Left for the sibling tickets

`scripts/init.js` exports `steps`, the ordered list of what init does (`doctor`, `rewrite`,
`scan`); the next tickets add to it rather than growing the rewrite step:

- **#54** reset `.claude/execution-queue.md`, clear the changelog, optional fresh git history, and
  self-delete (`scripts/init.js`, its test, this doc, the `init` script in `package.json`).
- **#55** `bun run repo:settings:apply` + labels — until then run it by hand after pushing.
- **#56** CI end-to-end test of the template: headless init on a fresh copy, then the JS gate.
