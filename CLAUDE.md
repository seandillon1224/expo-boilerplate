@AGENTS.md

# Expo Boilerplate — working agreement

Opinionated Expo template. Locked decisions (cited throughout as "PLAN.md decision N"): `docs/adr/0001-locked-architecture-decisions.md`. Queue ledger: `.claude/execution-queue.md`.

## Package manager: Bun (only)

`bun install` only. A `preinstall` guard rejects npm/yarn/pnpm. Run scripts with `bun run <script>`.
Bun's test runner is **not** used; unit/component tests are Jest (`jest-expo`).

## Commands

- `bun run doctor` — toolchain check (Bun / Node / git required; EAS CLI + login, gh, Maestro, Xcode, Android SDK, Java per lane) with versions and fix hints; exit 1 only on a missing required tool, `--strict` fails warnings, `--json` for machines. Also the first `init` step (`--skip-doctor`). Expected versions: `EXPECTED` in `scripts/doctor.js` (`docs/doctor.md`)
- `bun run init` — rebrand a fresh copy of the template (name / slug / scheme / bundle id / package / EAS project id / owner / GitHub repo), reset the queue ledger + stub `PLAN.md`, self-delete (`--keep-init`), optional fresh git history (`--fresh-git`, prompted), optional `repo:settings:apply` (`--apply-repo-settings`, prompted); `--yes` + flags for headless, `--dry-run` to preview. Rewrite + removal manifests and their drift guard in `scripts/init.js` / `scripts/__tests__/init.test.ts` (`docs/template-init.md`)
- `bun run template:e2e` — template end-to-end test: copies this checkout to a temp dir, runs the headless `bun run init --fresh-git` there (no EAS project id, no `EXPO_TOKEN`) and the JS gate on the generated project's first commit; the `Template init` CI job. `--keep` leaves the copy behind, `--dir <path>` picks where (`docs/template-init.md`)
- `bun run ios` / `android` / `web` — dev server (dev client / web)
- `bun run lint` — oxlint (defaults, `.oxlintrc.json` = ignores only) as a fast front pass, then ESLint (expo config + a11y + import sort + unused imports + local `require-testid`; rules oxlint owns are off via `eslint-plugin-oxlint`, ADR-0004). Warnings print, errors fail. Local ESLint rules live in `eslint-rules/` (never `eslint/`: Bun would resolve it instead of the binary)
- `bun run format` / `format:check` — Prettier
- `bun run typecheck` — `tsc --noEmit` (writes `expo-env.d.ts` first if missing)
- `bun run test` — Jest; `test:coverage` for coverage
- `bun run knip` — dead code / unused deps
- `bun run perf:baseline` then `bun run perf` — Reassure render-perf compare (`.reassure/output.md`); `perf:gate` fails on significant regressions, `perf:check` measures machine stability
- `bun run perf:flashlight` — Flashlight release-build CPU / RAM / FPS of one Maestro flow on an online Android emulator / device with the e2e build installed (`bun run e2e:android --keep` first): `--platform` (default `android`), `--device`, `--out` (default `flashlight`), `--iterations 5`, `--duration 10000`, `--flow .maestro/flows/fetch.yaml`, `--install`, `--no-fail` (the informational EAS hook mode, off behind the `FLASHLIGHT` constant in `e2e.yml`); ADR-0007, `docs/performance.md`
- `bun run observe:check` — EAS Observe startup-TTI check against `observe-budget.json` (`--platform`, `--days`, `--version`, `--update-id`, `--strict`; `--input <json>` offline); skips with a notice while Observe has no data / session (see `docs/observe.md`)
- `bun run export:web` (or `export:ios` / `export:android`) then `bun run budget` — JS-only export + gzip bundle-budget check (`bundle-budget.json`); `--platform web|ios|android` checks one, the default `all` checks every platform in the JSON (and needs all three exports)
- `bun run atlas` — dev server with Expo Atlas at `http://localhost:8081/_expo/atlas`; `bun run atlas:export` (one platform via `ATLAS_PLATFORM=web|ios|android`) — release export with Atlas on, then serve `.expo/atlas.jsonl` (`atlas:serve` re-opens it). Atlas is `EXPO_ATLAS=true`-gated and never set in CI / EAS (`docs/atlas.md`)
- `bun run e2e:web` — Maestro web flows (`.maestro/flows`, tag `web`) against the static export; needs `bun run export:web` and `bun run serve:web` running first
- `bun run e2e:build` → `e2e:repack` → `e2e:ios` / `e2e:android` — native lane on a laptop (fingerprint-matched EAS build → JS repack → Maestro on simulator/emulator); mirrors `.eas/workflows` jobs, see `docs/native-e2e.md`
- `bun run e2e:a11y` — screen-reader-output audit of Maestro's accessibility tree on a running simulator / device with the e2e build installed (`bun run e2e:<p> --keep` first): `--platform ios|android` (required), `--device`, `--out` (default `maestro-<p>/a11y`), `--no-fail` (the informational EAS hook mode); ADR-0005, `docs/testing.md`
- `bun run fingerprint` — native fingerprint hashes (= EAS Update runtime version) for iOS/Android; `--platform ios|android`, `--debug` (see `docs/environments-and-secrets.md`)
- `bun run devices:add` / `devices:list` — register / list iOS test devices (`eas device:create` / `device:list`); walkthrough in `docs/device-onboarding.md`
- `bun run env:check` — validate `EXPO_PUBLIC_*` against the Zod schema (also runs at app startup)
- `bun run env:pull` — pull EAS environment variables into `.env.local` (`EAS_ENV=preview|production bun run env:pull` for the other environments); uses the repo-pinned `eas-cli`
- `bun run i18n:extract` / `i18n:check` — sync `src/i18n/locales/*/common.json` with `t()` keys in code / fail if out of sync
- `bun run secrets:scan` — local gitleaks run with `.gitleaks.toml`, the same config as the `Secret scan` CI job (needs `gitleaks` on `PATH`; `docs/js-gate.md`)
- `bun run repo:settings:apply` / `repo:settings:check` — push / diff `main` branch protection + merge settings + `uat`/`production` environments + the automation's labels + GitHub Pages source = Actions (`scripts/repo-settings.js`; plain `repo:settings` is a dry run; `--only protection|repo|environments|labels|pages` for a subset). New labels used by workflows or skills go into `LABELS` there.
- `bun run docs:dev` / `docs:build` / `docs:preview` — the VitePress docs site over `docs/` (`docs/.vitepress/config.mts`: sidebar, landing page `docs/index.md`); `docs:build` fails on any dead relative link and is the `Docs` CI job; `.github/workflows/docs.yml` publishes it to GitHub Pages on push to `main` (`docs/conventions.md` → Docs)
- Full local gate before a PR: `bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check`

## Conventions

The human-readable version of these rules, with the reasoning, is `docs/conventions.md`; this list stays the agent brief.

- **Conventional Commits** are enforced by commitlint (commit-msg hook) and the PR-title check.
  Subject must be lowercase; PR titles become the squash commit message.
- Lefthook pre-commit runs oxlint → eslint --fix → prettier --write on staged files, sequentially
  (`piped: true`, glob `*.{js,cjs,mjs,ts,mts,tsx}`); pre-push runs typecheck + knip + i18n:check
  (`LEFTHOOK_EXCLUDE=knip git push` skips the slow one; `env:check` is CI-only).
- Source lives in `src/`; routes in `src/app/` (Expo Router, typed routes on). Path alias `@/` → `src/`.
- Every script in `scripts/` parses its command line with `scripts/lib/args.js` (one option table,
  `util.parseArgs`, uniform `--help`), exposes `main(argv)` returning an exit code, and ends with
  `runMain(main)` — never `process.exit()`. Codes: 0 ok, 1 the check failed, 2 usage / environment
  (`docs/conventions.md` → Scripts parse arguments and exit the same way).
- Scripts run under `node` (`bun run` only looks the script up). The EAS-hook scripts
  (`e2e-device-logs.js`, `a11y-audit.js`, `flashlight.js`), `e2e-common.js` and `scripts/lib/*` are
  **Node built-ins only, `node:`-prefixed** — a hook has no `node_modules`, and
  `scripts/__tests__/builtins-only.test.ts` walks the require graph to enforce it. Device / tool
  lookup (`which`, `sdkRoot`, `maestroBin`, `adbOnline`, `pickDevice`, `appId`, `display`) lives in
  `scripts/lib/device.js`; a repo-pinned CLI is spawned through `scripts/lib/bin.js`
  (`binPath` / `easBin`), never `bunx`. Resolve paths from `__dirname`, never `process.cwd()`.
- `app.config.ts` derives name / bundle id / package / scheme from `APP_VARIANT`
  (`development` | `staging` | `uat` | `production`). Never hardcode identifiers elsewhere.
- CNG only: never commit `ios/` or `android/`. Native changes go through config plugins.
- Every pressable / input gets a `testID` (lint-enforced) — Maestro flows never select by text.
- Maestro: `.maestro/` is a workspace (`maestro test .maestro`). Shared steps live once in
  `subflows/steps/`; `flows/<name>.yaml` (native) and `flows/web/<name>.yaml` (web) are thin entries.
- Flaky Maestro flows get the `quarantine` tag + a `flaky-flow` issue (docs/native-e2e.md → Flake
  budget); never delete assertions to make a flow pass.
- `docs/performance.md` is the entry point for perf: which layer (Rozenite / Atlas / bundle budget / Reassure / Observe / Sentry) answers which question, and the triage flow. Read it before adding a perf tool.
- Perf tests are `*.perf-test.tsx` under `src/__perf__/`, run by Reassure (`bun run perf`) not Jest; settings live in `reassure.setup.ts`, how-to in `docs/perf-tests.md`; CI compares each PR against its base commit.
- `@testing-library/react-native` v14: `render`, `rerender`, `unmount` are **async** — `await` them.
- TypeScript 6: `@types/*` are not auto-included; add to `types` in `tsconfig.json`.
- Versioning: `package.json` `version` is the single source of truth (`app.config.ts` reads it) and release-please owns it (`release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`; ADR-0002) — never hand-edit it or push a `vX.Y.Z` tag. `feat`/`fix`/`perf`/`revert` (and `!`) release; `chore`/`docs`/`ci`/`test`/`build`/`refactor`/`style` do not; Renovate PRs are `chore(deps)`. `fingerprint.config.js` skips `version` (`SourceSkips.ExpoConfigVersions`) so a bump never changes the native fingerprint; keep it.
- `eas.json` profiles map 1:1 to `APP_VARIANT`; `e2e-*` profiles are release-mode Maestro targets.
  The EAS project id lives once, as `EAS_PROJECT_ID` in `app.config.ts` (see `docs/environments-and-secrets.md`).
- EAS Observe (`src/lib/observe.ts`) owns prod perf telemetry and dispatches only when
  `extra.eas.projectId` is set. Every screen that loads data marks interactivity via `markInteractive`
  from `expo-observe` (`useObserve()`) once content is usable — never while loading. Startup TTI is
  budgeted in `observe-budget.json` and checked by `bun run observe:check` (informational in
  `deploy-staging.yml`, on demand in `observe-check.yml`; gating recipe in `docs/observe.md`).
- Sentry (`src/lib/sentry.ts`) is a no-op without `EXPO_PUBLIC_SENTRY_DSN`; tracing stays off.
  Build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` drive source-map uploads
  (`bun run sentry:sourcemaps` after `expo export` / `eas update`); never `EXPO_PUBLIC_`.
- `EXPO_PUBLIC_*` variables are read only through `@/lib/env` (schema in `src/lib/env.schema.ts`);
  never `process.env` directly. Document new keys in `.env.example`.
- EAS environment variables are the source of truth (`development` / `preview` / `production` ↔ dev / staging+UAT / prod);
  `.env.local` is pulled, never hand-edited. Every `eas.json` profile sets `environment`; profile `env` beats EAS vars of the same name.
- OTA updates: `useUpdatePolicy` (`src/features/updates/use-update-policy.ts`, ADR-0003) is the single place to
  change update behaviour; its driver is mounted once in `src/app/_layout.tsx` (check on launch + foreground,
  idle-resume reload after 30 min). Policy = `EXPO_PUBLIC_UPDATE_POLICY` (`silent` default | `opt-in` banner |
  `forced`); a single update is forced by `EAS_UPDATE_CRITICAL=1` at publish time (`app.config.ts` → manifest
  `extra.updatePolicy`, never an EAS env var) — `deploy-staging.yml` `critical=yes`; `promote.yml` `critical=yes`
  only verifies the group already carries it, and `rollout_percentage` stages a production promotion
  (runbook: `docs/release-ladder.md` → Update policies). Never call `expo-updates` actions from screens directly;
  `useUpdateInfo` is the read-only view.
- All user-facing strings go through `t()` from `react-i18next` (keys typed against `src/i18n/locales/en/common.json`);
  run `bun run i18n:extract` after adding keys.
- Rozenite (`docs/rozenite.md`) is the dev-only React Native DevTools plugin host: `metro.config.js` gates it on `WITH_ROZENITE=true` (set by `bun run start|ios|android`), plugin hooks live only in `src/lib/devtools-plugins.ts` behind the `__DEV__` `require` in `src/lib/devtools.ts`; never import `@rozenite/*` elsewhere, and add a project-local plugin as a `link:` devDependency.
- Loading / empty / error UI comes from `@/components/states` (`LoadingState`, `EmptyState`, `ErrorState`);
  pass screen-specific `testID`s through. Render errors: `ErrorBoundary` (`@/components/error-boundary`)
  for subtrees; routes get `RouteErrorBoundary` via the root layout's `ErrorBoundary` export.

## CI/CD shape (see PLAN.md decisions 1–3, 12–13)

- GitHub Actions (`.github/workflows/ci.yml`) = JS gate only (lint, typecheck, unit, knip, format, commitlint on the commit range, secret scan, bundle budget, Maestro web, docs build, template init).
- `Fingerprint drift` (`ci.yml`, informational, not required) compares the production-variant `@expo/fingerprint` hash of base vs PR and upserts one PR comment + `fingerprint-drift` label on drift: merging means a staging build, and a store release (`vX.Y.Z` tag) before production promotion (`docs/release-ladder.md` → Fingerprint drift on PRs).
- `.github/workflows/pr-title.yml` lints the PR title with the same `commitlint.config.js` (the title becomes the squash commit).
- Required checks on `main` (every CI job except `Perf (Reassure)` and `Fingerprint drift`, which are listed in `INFORMATIONAL`; a Jest test fails if a job is in neither list), merge settings (squash-only, auto-merge on for Renovate), environments and labels are managed by `scripts/repo-settings.js`; run `bun run repo:settings:apply` once after creating a repo from the template (the init script offers to).
- EAS Workflows = native lane (fingerprint → get-build/build → repack → maestro → update → approval → submit).
  Both Maestro platforms run on every PR; iOS can be tiered down via the `IOS_MODE` constant / `ios_mode` input in `.eas/workflows/e2e.yml` (`always` | `main-only` | `label`, see `docs/native-e2e.md`).
- EAS Workflows live in `.eas/workflows/*.yml` (one file per workflow: `register-device.yml`, `e2e.yml` = the PR native E2E check, see `docs/native-e2e.md`; `e2e-cloud.yml` = opt-in (`e2e:cloud` label) Maestro Cloud run of the cached e2e builds, off until `MAESTRO_CLOUD` is flipped (ADR-0006); `preview-web.yml` = PR web preview to the EAS Hosting `pr-<number>` alias + PR comment (behind `HOSTING`); `deploy-staging.yml` = push-to-main staging rung, `promote.yml` = manual, approval-gated uat / production republish of a staging update group, `rollout.yml` = manual, approval-gated ramp of a production rollout group (`update-rollout`, choice `25|50|75|100`; other numbers via `eas update:edit`), `release.yml` = tag-triggered store release (`testflight` job → App Store Connect internal group `Internal`), dispatched by `.github/workflows/release.yml` behind the `production` GitHub Environment; `backport.yml` = manual, approval-gated OTA of a `main` fix cherry-picked onto older store release tags, fingerprint-gated, straight to `production` — the one sanctioned ladder skip (ADR-0008, unverified until the first store release); see `docs/release-ladder.md`). Validate with `bun run eas workflow:validate <file>`; run with `bun run eas workflow:run <file>`.
- `main` → OTA to `staging` (`.eas/workflows/deploy-staging.yml`, see `docs/release-ladder.md`); UAT/production are manual, approval-gated promotions of the same update group. Store builds: merge the release-please PR (`.github/workflows/release-please.yml` tags `vX.Y.Z`; needs the `RELEASE_PLEASE_TOKEN` secret) → `.github/workflows/release.yml` (reviewer) → `.eas/workflows/release.yml` (build + TestFlight / Play internal, skipped when the fingerprint is unchanged).
- Which checks gate merge, how merging/auto-merge works, how to change the required set: `docs/js-gate.md`.
- Entry point for anything that runs in CI (every GitHub Actions job and EAS workflow, triggers, repo constants, what each needs, red-check triage): `docs/ci-overview.md`. Test layers and how to write each kind: `docs/testing.md`.
- Build sharing (PLAN.md decision 12): install page + QR per internal build, links posted by the `slack` jobs (`SLACK_WEBHOOK_URL`, EAS secret) and `github-comment`; engineers use Expo Orbit: `docs/build-sharing.md`. Designer / tester one-pager: `docs/install-staging-app.md`.

## Queue process

One ticket per PR, branched off `main`, squash-merged immediately, issue closed on merge.
Drive it with `/ship-next`. The ledger is the resumable source of truth; GitHub Issues mirror it.
