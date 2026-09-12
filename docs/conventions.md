# Conventions

The house rules, in one place and written for people. `CLAUDE.md` is the same set compressed into an
agent brief; `PLAN.md` holds the decisions the rules come from. When a rule here says "lint-enforced"
or "hook-enforced", the enforcement is the source of truth and this page is the explanation.

## Toolchain

- **Bun only.** `bun install`; a `preinstall` guard (`scripts/preinstall-guard.js`) rejects npm,
  yarn and pnpm, and `bun.lock` is the only lockfile. Run scripts as `bun run <script>` — the
  scripts themselves are plain Node (`scripts/*.js`) or Bun (`*.ts`), and every one takes `--help`.
  Bun's test runner is not used; tests are Jest ([Testing](testing.md)).
- **Pinned versions.** Bun from `.bun-version`, Node from `.node-version` (for tools that need it),
  `eas-cli` from `package.json` (always `bun run eas ...`, never a global install), Maestro at the
  version `.github/workflows/ci.yml` pins. `bun run doctor` checks all of them ([Toolchain check](doctor.md)).
- **TypeScript 6, strict.** `@types/*` packages are not auto-included; add a package to `types` in
  `tsconfig.json` when its globals are needed. Scripts under `scripts/` deliberately stay without
  `@types/node` (they `require` with an eslint-disable line).
- **Expo SDK docs by version.** Before writing code against an Expo API, read the docs for the
  pinned SDK (`AGENTS.md` carries the URL); APIs move between SDKs.

## Commits and PR titles

- **Conventional Commits, lowercase subject.** `commitlint.config.js` extends
  `@commitlint/config-conventional` with body / footer line-length checks off. Enforced three times:
  the lefthook `commit-msg` hook, the `Commitlint` job on every commit in the PR range, and the
  `PR title` check — because the PR title becomes the squash commit subject on `main`
  ([JS gate → How merging works](js-gate.md#how-merging-works)).
- **One ticket, one PR, one squash commit**, branched off `main`, merged as soon as the required
  checks are green, `Closes #n` in the PR body so the issue closes on merge. `/ship-next` drives
  the queue; `.claude/execution-queue.md` is the ledger and GitHub Issues mirror it.
- **Types decide releases** ([ADR-0002](adr/0002-release-please-versioning.md)). release-please
  reads the squash commits on `main`: `feat` → minor, `fix` / `perf` / `revert` → patch, a `!` after
  the type or a `BREAKING CHANGE:` footer → major; these four types are the changelog. `docs`,
  `ci`, `test`, `chore`, `build`, `refactor` and `style` are hidden and never open a release PR.
  Every Renovate PR is `chore(deps)` (`.github/renovate.json5`), so a dependency bump alone never
  releases — mark a dependency change that users should see with a `fix`/`feat` follow-up commit.
  Use a scope where it helps (`ci(eas):`, `test(e2e):`, `chore(queue):`).
- **Never hand-edit `version`.** `package.json` `version` is the single source of truth
  (`app.config.ts` reads it); the release PR bumps it and the merge is tagged
  ([Release ladder → Store release](release-ladder.md#store-release-tag)). To pin a specific next
  version, add a `Release-As: X.Y.Z` footer to the PR body.

## Hooks (lefthook)

`lefthook.yml` is installed by the `prepare` script on `bun install`:

| Hook         | Runs                                                                           | Why it is here and not only in CI                                          |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `pre-commit` | `eslint --fix` and `prettier --write` on staged files (fixes are re-staged)    | Formatting never reaches a PR diff                                         |
| `commit-msg` | `commitlint --edit`                                                            | A bad subject fails before it exists                                       |
| `pre-push`   | `bun run typecheck`, `bun run knip`, `bun run env:check`, `bun run i18n:check` | The fast half of the gate; tests stay local-on-demand to keep pushes short |

Skip a hook only for a `chore(queue)` ledger commit or an emergency (`LEFTHOOK=0 git push`); CI
runs the same checks anyway.

## Source layout

```text
src/
  app/            Expo Router routes only (typed routes on). _layout.tsx files own providers and error boundaries.
  components/     Shared UI; components/states = LoadingState / EmptyState / ErrorState; error boundaries.
  features/       One folder per domain (posts, updates): API clients, hooks, feature-local components.
  lib/            App-wide infrastructure: env, sentry, observe, query-client, devtools.
  providers/      React providers composed by the root layout.
  i18n/           i18next setup + locales/<lang>/common.json (typed keys via i18next.d.ts).
  tw/             Styling primitives (NativeWind) — the View / Text every screen imports.
  __tests__/      Jest tests grouped by kind (screens / components / features / i18n); lib tests sit in lib/__tests__.
  __perf__/       Reassure perf tests (*.perf-test.tsx), never run by Jest.
scripts/          Plain-Node tooling with tests in scripts/__tests__.
.maestro/         The Maestro workspace (flows/, flows/web/, subflows/steps/).
.eas/workflows/   EAS Workflows, one file per workflow.
.github/          Actions workflows, the composite setup action, issue templates, Renovate config.
docs/             One markdown page per concern.
```

- Import through the `@/` alias (`@/lib/env`, `@/components/states`), never relative paths that
  climb out of a folder. `simple-import-sort` orders imports (lint-fixed).
- Route files export a screen as default and nothing else that is not a Router convention
  (`ErrorBoundary`, `unstable_settings`). Logic lives in `features/`, not in `app/`.
- Platform forks use file suffixes (`animated-icon.web.tsx`, `devtools.web.ts`); `knip.jsonc` lists
  them as entries so they are not reported as unused.
- Naming: kebab-case files (`use-update-policy.ts`, `error-state.tsx`), PascalCase components,
  `useX` hooks, `*.test.tsx` / `*.perf-test.tsx` suffixes, Maestro flow names `native/<name>` and
  `web/<name>`.

## App-layer rules

### Every pressable and input has a `testID`

`local/require-testid` (`eslint/rules/require-testid.js`) is an error. Maestro selects by `id:`
only — the identifier works as accessibility identifier on iOS, resource-id on Android and DOM id
on web — so a component without a `testID` is untestable end to end. Shared components (the states,
buttons) accept `testID` as a prop and pass it through; screens name theirs by screen
(`fetch-retry`, `settings-sentry-test`). Jest tests query the same ids.

### Strings go through `t()`

Every user-facing string is `t('some.key')` from `react-i18next`, with keys typed against
`src/i18n/locales/en/common.json`. After adding a key, `bun run i18n:extract` writes it to the
catalog (the default value is the key itself, so an untranslated string is visible, not blank) and
`bun run i18n:check` fails CI and `pre-push` if code and catalog disagree. Tests render the real
`en` catalog; do not mock i18n.

### Env is read through `@/lib/env`

`EXPO_PUBLIC_*` variables are declared once in `src/lib/env.schema.ts` (Zod) and read only via
`import { env } from '@/lib/env'` — never `process.env` in app code. A bad value throws at import
time in development and falls back to defaults in production; `bun run env:check` is the CI gate.
A new key goes into the schema, `.env.example` (documented, empty placeholder) and, for real
values, EAS environment variables (`bun run eas env:set ...`); `.env.local` is pulled with
`bun run env:pull`, never hand-edited ([Environments and secrets](environments-and-secrets.md)).
Build-time secrets (`SENTRY_AUTH_TOKEN`, `EXPO_TOKEN`) are never `EXPO_PUBLIC_`.

### One config, four variants, no native folders

- `app.config.ts` derives the name, bundle id, Android package and URL scheme from `APP_VARIANT`
  (`development` | `staging` | `uat` | `production`). Nothing else hardcodes an identifier; the
  EAS project id lives once there as `EAS_PROJECT_ID`. `eas.json` profiles map 1:1 to variants and
  set `environment` so `EXPO_PUBLIC_*` resolve per rung.
- **CNG only**: `ios/` and `android/` are never committed. Native changes are config plugins or
  `app.config.ts` fields, which is what makes `@expo/fingerprint` the runtime version and lets CI
  reuse builds. A change that moves the fingerprint is flagged on the PR
  ([Release ladder → Fingerprint drift](release-ladder.md#fingerprint-drift-on-prs-informational)).

### Updates go through `useUpdatePolicy`

`src/features/updates/use-update-policy.ts` is the only place that calls `expo-updates` actions
(check, download, reload). Its driver (`useUpdatePolicyDriver`) is mounted once by the root layout
and runs the policy on launch and on every return to the foreground; screens never import
`expo-updates`, and `useUpdateInfo` is the read-only view for display. This keeps the update
behaviour a one-file decision when a project changes it
([ADR-0003](adr/0003-update-policies.md)).

- **Policy per build:** `EXPO_PUBLIC_UPDATE_POLICY` = `silent` (default: download in the
  background, apply on the next cold start or idle resume, no UI) | `opt-in` (same, plus the
  "Update ready" banner with Restart now / Later) | `forced` (every downloaded update reloads at
  once, Sentry flushed first). Set per EAS environment; recommended `forced` on `preview`,
  `silent` on `production`.
- **Critical per update:** `EAS_UPDATE_CRITICAL=1` at publish time makes `app.config.ts` write
  `extra.updatePolicy: 'forced'` into the update manifest; the app reads it from the incoming
  update and reloads immediately whatever the build policy. It is a workflow input (#137), never
  an EAS environment variable, and `fingerprint.config.js` keeps `extra` out of the runtime
  version so a critical publish still matches the installed builds.
- **Idle resume (every policy):** coming back to the foreground after ≥ 30 minutes in the
  background (`RESUME_RELOAD_AFTER_MS`) with an update already downloaded reloads into it.
- The Updates screen (Settings → OTA updates) shows the active policy and keeps the manual
  check / download buttons as the test bed.

### Loading, empty and error UI is shared

Screens compose `LoadingState`, `EmptyState` and `ErrorState` from `@/components/states` instead of
hand-rolled placeholders, passing screen-specific `testID`s and `t()` copy. Render errors are
caught by `ErrorBoundary` (`@/components/error-boundary`) around a subtree, and every route gets
`RouteErrorBoundary` through the root layout's `ErrorBoundary` export (a route can export its own
to override). Both report to Sentry through `captureException`.

### Telemetry contracts

- Every screen that loads data calls `markInteractive` from `useObserve()` once its content is
  usable — the empty state counts, loading and error do not. Tests assert it
  ([EAS Observe → The `markInteractive` contract](observe.md#the-markinteractive-contract-what-tti-means-for-this-app)).
- Sentry is errors only (`src/lib/sentry.ts`, no-op without `EXPO_PUBLIC_SENTRY_DSN`, tracing off);
  production performance is Observe's job ([Performance](performance.md)).

## Delivery rules

- `main` is trunk; every merge lands on `staging` by itself. UAT and production are approval-gated
  republishes of the same update group — never a re-bundle — and an update only reaches builds
  with the same fingerprint ([Release ladder](release-ladder.md)).
- Workflow behaviour that depends on something the owner has not set up yet is behind a repo
  constant (`HOSTING`, `IOS_BUILDS`, `IOS_RELEASE`, `PLAY_SUBMIT`, `IOS_MODE`), flipped in a PR
  ([CI overview → Repo constants](ci-overview.md#repo-constants)). Runs stay green until then.
- Required checks, merge settings, environments and labels are code
  (`scripts/repo-settings.js`); change them there and re-apply, never in the GitHub UI
  ([JS gate → Changing the required set](js-gate.md#changing-the-required-set)).
- Bundle budgets are raised only with an Atlas finding in the PR; perf tests are added for every
  cost you just fixed ([Performance](performance.md)).
- Store releases are two human steps — merge the release PR, approve the `production` Environment —
  and the tag is release-please's, never pushed by hand
  ([Release ladder → Store release](release-ladder.md#store-release-tag)). `fingerprint.config.js`
  keeps the version bump out of the native fingerprint; do not remove that skip.

## Docs

- **One page per concern** under `docs/`, named for the concern (`native-e2e.md`, not `e4.md`), with
  a one-line entry in the README's Docs index and, when a command or rule is involved, a pointer in
  `CLAUDE.md`. [CI overview](ci-overview.md) is the entry point for anything that runs in CI.
- Explain _why_ in the doc and keep the YAML / script comments short and pointing here (EAS caps a
  workflow file at 16 KiB).
- Link sections, not just files (`js-gate.md#how-merging-works`), and cite decisions as
  "PLAN.md decision N" so the reference survives `bun run init`, which keeps the decisions table.
- Prettier formats markdown (tables are re-aligned on commit); `bun run format:check` is a required
  check.
- New docs must not contain the template's own identity (name, slug, bundle id, Expo account,
  GitHub owner) except in the exact spots `scripts/init.js` rewrites — `bun run template:e2e`
  fails on any leftover. Prefer `<owner>/<repo>` placeholders or a link to the doc that already
  carries the rewritten value ([Template init → What it rewrites](template-init.md#what-it-rewrites)).

## Changing a locked decision

The "Locked decisions" table in `PLAN.md` is what `CLAUDE.md` and every doc cite by number. To
change one:

1. Open an issue that names the decision number, what changes and why, and what it breaks
   (workflows, docs, the required-check set).
2. Grill the proposal (`/grill-me` exists for exactly this) until the trade-offs are written down.
3. Record the outcome as an ADR in [`docs/adr/`](adr/README.md): copy the template, take the next
   number, mark the entry in [ADR-0001](adr/0001-locked-architecture-decisions.md) as superseded,
   and update the row in `PLAN.md` in the same PR.
4. Then the implementation PRs, each citing the ADR. Deferred deep dives (`D1`–`D7` in `PLAN.md`)
   follow the same path: research ticket → grill → ADR → epic.
