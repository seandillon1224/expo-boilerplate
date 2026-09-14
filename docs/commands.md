# Commands

Every `package.json` script, what it does and the flags it takes. Bun runs them all
(`bun run <script>`; a `preinstall` guard rejects npm / yarn / pnpm) but the scripts themselves are
plain Node or Bun, and every `scripts/*.js` one also takes `--help`
([Conventions → Scripts](conventions.md#scripts-parse-arguments-and-exit-the-same-way)).

`CLAUDE.md` is the agent brief and keeps only the handful an agent runs unprompted; this page is the
full reference for humans.

## The local gate

Run before opening a PR — the same checks `CI` runs, in the order that fails fastest:

```sh
bun run lint && bun run typecheck && bun run test && bun run knip && \
  bun run format:check && bun run env:check && bun run i18n:check
```

| Command                               | Does                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`                        | `oxlint` (defaults; `.oxlintrc.json` is ignores only) as a fast front pass, then ESLint (expo config, a11y, import sort, unused imports, the local `require-testid` rule). Warnings print, errors fail. ADR-0004 |
| `bun run typecheck`                   | `tsc --noEmit` (writes `expo-env.d.ts` first if missing)                                                                                                                                                         |
| `bun run test`                        | Jest (`jest-expo` + RNTL); `test:watch`, `test:coverage`                                                                                                                                                         |
| `bun run knip`                        | Dead code, unused exports and dependencies; `knip:fix` applies what it can                                                                                                                                       |
| `bun run format` / `format:check`     | Prettier over everything not in `.prettierignore`, markdown included                                                                                                                                             |
| `bun run env:check`                   | Validates `EXPO_PUBLIC_*` against the Zod schema (also runs at app startup)                                                                                                                                      |
| `bun run i18n:extract` / `i18n:check` | Syncs `src/i18n/locales/*/common.json` with the `t()` keys in code / fails when they disagree                                                                                                                    |
| `bun run secrets:scan`                | Local gitleaks run with `.gitleaks.toml`, the same config as the `Secret scan` job (needs `gitleaks` on `PATH`)                                                                                                  |
| `bun run docs:build`                  | VitePress build of `docs/`; fails on any dead relative link (the `Docs` job)                                                                                                                                     |

More: [JS gate → Running the gate locally](js-gate.md#running-the-gate-locally).

## Develop

| Command                             | Does                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run start`                     | Dev server (dev client), Rozenite on (`WITH_ROZENITE=true`)                                                                                                                                                                                                                                                                              |
| `bun run ios` / `android` / `web`   | Dev server targeting a simulator / emulator / the browser                                                                                                                                                                                                                                                                                |
| `bun run doctor`                    | Toolchain check: Bun / Node / git required, EAS CLI + login, gh, Maestro, Xcode, Android SDK and Java per lane, with versions and fix hints. Exit 1 only on a missing **required** tool; `--strict` fails on warnings, `--json` for machines. Expected versions live in `EXPECTED` in `scripts/doctor.js` ([Toolchain check](doctor.md)) |
| `bun run docs:dev` / `docs:preview` | The docs site locally (`docs/.vitepress/config.mts` holds the sidebar; `docs/index.md` is the landing page)                                                                                                                                                                                                                              |

## Environments and secrets

| Command                                | Does                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run env:pull`                     | Pulls EAS environment variables into `.env.local` (`EAS_ENV=preview\|production bun run env:pull` for the other environments); uses the repo-pinned `eas-cli`                                       |
| `bun run fingerprint`                  | The `@expo/fingerprint` hashes (= the EAS Update runtime version): `--platform ios\|android` prints one as a bare string, no flag prints both as JSON, `--debug` lists every source behind the hash |
| `bun run devices:add` / `devices:list` | Register / list iOS test devices (`eas device:create` / `device:list`) — walkthrough in [Device onboarding](device-onboarding.md)                                                                   |
| `bun run sentry:sourcemaps`            | Uploads source maps after an `expo export` / `eas update`; needs build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (never `EXPO_PUBLIC_`)                                            |

Details: [Environments and secrets](environments-and-secrets.md).

## Tests and E2E

| Command                           | Does                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run e2e:web`                 | Maestro `web`-tagged flows (`.maestro/flows/web/`) against the static export; needs `bun run export:web` and `bun run serve:web` running first                                                                                                                                 |
| `bun run e2e:build`               | Downloads a fingerprint-matched EAS build of the `e2e-*` profile: `--platform ios\|android` (default `ios`), `--build` cuts a paid build on a miss, `--build-id <id>` skips matching                                                                                           |
| `bun run e2e:repack`              | Repacks this commit's JS into that build: `--platform`, `--verbose`                                                                                                                                                                                                            |
| `bun run e2e:ios` / `e2e:android` | Maestro on a simulator / emulator: `--device <id>`, `--keep` (leave the app installed), `--quarantine-only`                                                                                                                                                                    |
| `bun run e2e:a11y`                | Screen-reader audit of Maestro's accessibility tree on a device with the e2e build installed (`bun run e2e:<p> --keep` first): `--platform ios\|android` (required), `--device`, `--out` (default `maestro-<p>/a11y`), `--no-fail` (the informational EAS hook mode). ADR-0005 |

The native lane mirrors the `.eas/workflows` jobs: [Native E2E](native-e2e.md). Test layers and how
to write one more of each: [Testing](testing.md).

## Performance

| Command                                                                         | Does                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run perf:baseline` then `bun run perf`                                     | Reassure render-perf compare, report in `.reassure/output.md`; `perf:gate` exits 1 on a significant regression, `perf:check` measures the machine's stability                                                                                                                                                                                                     |
| `bun run export:web` (or `export:ios` / `export:android`) then `bun run budget` | JS-only export plus the gzip bundle-budget check (`bundle-budget.json`); `--platform web\|ios\|android` checks one, the default `all` checks every platform in the JSON (and needs all three exports), `--dist <dir>` points at another export                                                                                                                    |
| `bun run atlas`                                                                 | Dev server with Expo Atlas at `http://localhost:8081/_expo/atlas`; `atlas:export` (one platform via `ATLAS_PLATFORM=web\|ios\|android`) is a release export with Atlas on, then serves `.expo/atlas.jsonl` (`atlas:serve` re-opens it). Atlas is `EXPO_ATLAS=true`-gated and never set in CI / EAS                                                                |
| `bun run perf:flashlight`                                                       | Flashlight release-build CPU / RAM / FPS of one Maestro flow on an online Android emulator / device with the e2e build installed (`bun run e2e:android --keep` first): `--platform` (default `android`), `--device`, `--out` (default `flashlight`), `--iterations 5`, `--duration 10000`, `--flow .maestro/flows/fetch.yaml`, `--install`, `--no-fail`. ADR-0007 |
| `bun run observe:check`                                                         | EAS Observe startup-TTI check against `observe-budget.json`: `--platform`, `--days`, `--version`, `--update-id`, `--strict`, `--input <json>` (offline). Skips with a notice while Observe has no data / session                                                                                                                                                  |

Which layer answers which question, and the triage flow: [Performance](performance.md).

## Release and repo

| Command                                                        | Does                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run eas workflow:validate <file>` / `workflow:run <file>` | Validate / run an EAS workflow (`.eas/workflows/*.yml`, `-F input=value` for dispatch inputs)                                                                                                         |
| `bun run repo:settings`                                        | Dry run of the repo settings: `main` branch protection, merge settings, the `uat` / `production` environments, the automation's labels and GitHub Pages source = Actions (`scripts/repo-settings.js`) |
| `bun run repo:settings:apply` / `repo:settings:check`          | Push / diff those settings; `--only protection\|repo\|environments\|labels\|pages` works on a subset. New labels used by workflows or skills go into `LABELS` in the same file first                  |

Every workflow, trigger and repo constant: [CI overview](ci-overview.md). The runbook from a merge
to the stores: [Release ladder](release-ladder.md).

## Template

Only while this checkout is the template itself; running the init script removes both and this section.

- `bun run init` — rebrand a fresh copy of the template (name / slug / scheme / bundle id / package / EAS project id / owner / GitHub repo), reset the queue ledger + stub `PLAN.md`, self-delete (`--keep-init`), optional fresh git history (`--fresh-git`, prompted), optional `repo:settings:apply` (`--apply-repo-settings`, prompted); `--yes` plus flags for headless, `--dry-run` to preview, `--skip-doctor` to skip the toolchain check it starts with. Rewrite and removal manifests and their drift guard live in `scripts/init.js` / `scripts/__tests__/init.test.ts` ([Template init](template-init.md))
- `bun run template:e2e` — copies this checkout to a temp dir, runs the headless init there (no EAS project id, no `EXPO_TOKEN`) and the JS gate on the generated project's first commit; the `Template init` CI job. `--keep` leaves the copy behind, `--dir <path>` picks where ([Template init → End-to-end test](template-init.md#end-to-end-test))
