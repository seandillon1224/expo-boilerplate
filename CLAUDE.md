@AGENTS.md

# Expo Boilerplate — working agreement

Opinionated Expo template. Locked decisions (cited throughout as "PLAN.md decision N"): `docs/adr/0001-locked-architecture-decisions.md`. Queue ledger: `.claude/execution-queue.md`.

Where the detail lives: `docs/commands.md` (every script with its flags), `docs/conventions.md` (the
house rules in full — every rule below is there too), `docs/ci-overview.md` (every GitHub Actions job
and EAS workflow, triggers, repo constants, red-check triage), `docs/testing.md` (test layers),
`docs/performance.md` (which perf layer answers what). One page per concern under `docs/`: read the
one that owns the area first; a new page joins the README index and `docs/.vitepress/config.mts`.

## Package manager: Bun (only)

`bun install` only. A `preinstall` guard rejects npm/yarn/pnpm. Run scripts with `bun run <script>`.
Bun's test runner is **not** used; unit/component tests are Jest (`jest-expo`).

## Commands

What an agent runs unprompted; the full reference with flags is `docs/commands.md`.

- `bun run lint` — oxlint front pass, then ESLint (warnings print, errors fail)
- `bun run typecheck` — `tsc --noEmit`
- `bun run test` — Jest (`test:watch`, `test:coverage`)
- `bun run knip` — dead code / unused deps
- `bun run format` / `format:check` — Prettier
- `bun run env:check` — `EXPO_PUBLIC_*` against the Zod schema
- `bun run i18n:extract` / `i18n:check` — sync / verify the `t()` keys in the catalogs
- `bun run docs:build` — VitePress build of `docs/`; fails on any dead relative link
- Full local gate before a PR: `bun run lint && bun run typecheck && bun run test && bun run knip && bun run format:check && bun run env:check && bun run i18n:check`

## Non-negotiables

The reasoning, and the rules not repeated here, are in `docs/conventions.md`.

- **Conventional Commits**, lowercase subject — commitlint (commit-msg hook) and the PR-title check enforce it, and the PR title becomes the squash commit. `Closes #n` goes in the PR **body**.
- Source lives in `src/`; routes in `src/app/` (Expo Router, typed routes on). Import through the `@/` alias → `src/`, never a path that climbs out of a folder.
- **CNG only**: never commit `ios/` or `android/`. Native changes are config plugins or `app.config.ts` fields; `app.config.ts` derives name / bundle id / package / scheme from `APP_VARIANT` (`development` | `staging` | `uat` | `production`) — never hardcode an identifier elsewhere.
- Every pressable / input gets a `testID` (lint-enforced) — Maestro selects by id, never by text.
- Maestro: `.maestro/` is one workspace; shared steps live once in `subflows/steps/`, with thin `flows/<name>.yaml` (native) and `flows/web/<name>.yaml` entries. A flaky flow gets the `quarantine` tag and a `flaky-flow` issue — never a deleted assertion (`docs/native-e2e.md`).
- All user-facing strings go through `t()` (`react-i18next`, keys typed against `src/i18n/locales/en/common.json`); run `bun run i18n:extract` after adding one.
- `EXPO_PUBLIC_*` is read only through `@/lib/env` (schema in `src/lib/env.schema.ts`), never `process.env`; document new keys in `.env.example`. EAS environment variables are the source of truth and `.env.local` is pulled, never hand-edited. Build-time secrets (`SENTRY_AUTH_TOKEN`, `EXPO_TOKEN`) are never `EXPO_PUBLIC_`.
- Versioning: release-please owns `package.json` `version`, the single source of truth `app.config.ts` reads (ADR-0002) — never hand-edit it or push a `vX.Y.Z` tag.
- Colour has one source: `src/tw/tokens.ts`. `src/global.css` mirrors it as CSS variables + `@theme inline`
  (drift-tested by `src/tw/__tests__/tokens.test.ts`) and `navigationTheme()` (`src/tw/navigation-theme.ts`)
  feeds the same tokens to the root `ThemeProvider`; never hardcode a hex or use React Navigation's stock themes.
- Loading / empty / error UI comes from `@/components/states` with screen-specific `testID`s; render errors go through `ErrorBoundary` / the root layout's `RouteErrorBoundary`.
- OTA behaviour changes in exactly one place, `useUpdatePolicy` (ADR-0003); screens never call `expo-updates` actions. Every screen that loads data calls `markInteractive` once content is usable, never while loading.
- `@rozenite/*` is imported only in `src/lib/devtools-plugins.ts`, behind the `__DEV__` require in `src/lib/devtools.ts` (`docs/rozenite.md`).
- Scripts in `scripts/` parse their command line with `scripts/lib/args.js`, return an exit code from `main(argv)` (never `process.exit()`), and — for the EAS-hook ones and `scripts/lib/*` — use `node:`-prefixed built-ins only.
- `@testing-library/react-native` v14: `render`, `rerender`, `unmount` are **async** — `await` them. TypeScript 6: `@types/*` are not auto-included; add them to `types` in `tsconfig.json`.

## CI/CD shape (see PLAN.md decisions 1–3, 12–13)

- GitHub Actions (`.github/workflows/ci.yml`) = JS gate only (lint, typecheck, unit, knip, format, env, i18n, commitlint on the commit range, secret scan, bundle budgets, Maestro web, docs build, template init); `Perf (Reassure)` and `Fingerprint drift` are informational, everything else is a required check.
- EAS Workflows = the native lane and the delivery ladder (fingerprint → get-build/build → repack → maestro → update → approval → submit). `main` publishes an OTA to `staging`; UAT and production are manual, approval-gated republishes of that same update group; a store release rides a `vX.Y.Z` tag.
- The map — every job and workflow, what triggers it, the repo constants that keep owner-dependent jobs skipped, and the "when something is red" table: `docs/ci-overview.md` (the workflow-by-workflow table is `docs/ci-overview.md#eas-workflows-easworkflows`). What gates merge and how to change the required set: `docs/js-gate.md`. The runbook from a merge to the stores: `docs/release-ladder.md`.
- Required checks, merge settings, environments and labels are code (`scripts/repo-settings.js`), never the GitHub UI; new automation labels go into `LABELS` there first.

## Queue process

One ticket per PR, branched off `main`, squash-merged immediately, issue closed on merge.
Drive it with `/ship-next`. The ledger is the resumable source of truth; GitHub Issues mirror it.
