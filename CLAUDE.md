@AGENTS.md

# Expo Boilerplate — working agreement

Opinionated Expo template. Design and ticket breakdown: `PLAN.md`. Queue ledger: `.claude/execution-queue.md`.

## Package manager: Bun (only)

`bun install` only. A `preinstall` guard rejects npm/yarn/pnpm. Run scripts with `bun run <script>`.
Bun's test runner is **not** used; unit/component tests are Jest (`jest-expo`).

## Commands

- `bun run ios` / `android` / `web` — dev server (dev client / web)
- `bun run lint` — ESLint (expo config + a11y + import sort + unused imports)
- `bun run format` / `format:check` — Prettier
- `bun run typecheck` — `tsc --noEmit` (writes `expo-env.d.ts` first if missing)
- `bun run test` — Jest; `test:coverage` for coverage
- `bun run knip` — dead code / unused deps
- `bun run env:check` — validate `EXPO_PUBLIC_*` against the Zod schema (also runs at app startup)
- `bun run i18n:extract` / `i18n:check` — sync `src/i18n/locales/*/common.json` with `t()` keys in code / fail if out of sync
- Full local gate before a PR: `bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check`

## Conventions

- **Conventional Commits** are enforced by commitlint (commit-msg hook) and the PR-title check.
  Subject must be lowercase; PR titles become the squash commit message.
- Lefthook runs eslint/prettier on staged files (pre-commit) and typecheck + knip + env/i18n checks (pre-push).
- Source lives in `src/`; routes in `src/app/` (Expo Router, typed routes on). Path alias `@/` → `src/`.
- `app.config.ts` derives name / bundle id / package / scheme from `APP_VARIANT`
  (`development` | `staging` | `uat` | `production`). Never hardcode identifiers elsewhere.
- CNG only: never commit `ios/` or `android/`. Native changes go through config plugins.
- Every pressable / input gets a `testID` (lint-enforced) — Maestro flows never select by text.
- `@testing-library/react-native` v14: `render`, `rerender`, `unmount` are **async** — `await` them.
- TypeScript 6: `@types/*` are not auto-included; add to `types` in `tsconfig.json`.
- EAS Observe (`src/lib/observe.ts`) owns prod perf telemetry and is silent until `eas init` adds
  `extra.eas.projectId`. Every screen that loads data marks interactivity via `markInteractive`
  from `expo-observe` (`useObserve()`) once content is usable — never while loading.
- Sentry (`src/lib/sentry.ts`) is a no-op without `EXPO_PUBLIC_SENTRY_DSN`; tracing stays off.
  Build-time `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` drive source-map uploads
  (`bun run sentry:sourcemaps` after `expo export` / `eas update`); never `EXPO_PUBLIC_`.
- `EXPO_PUBLIC_*` variables are read only through `@/lib/env` (schema in `src/lib/env.schema.ts`);
  never `process.env` directly. Document new keys in `.env.example`.
- OTA updates: `useUpdatePolicy` (`src/features/updates/use-update-policy.ts`) is the single place to
  change update behaviour (check / download / reload, and later forced / opt-in / silent + rollout);
  never call `expo-updates` actions from screens directly. `useUpdateInfo` is the read-only view.
- All user-facing strings go through `t()` from `react-i18next` (keys typed against `src/i18n/locales/en/common.json`);
  run `bun run i18n:extract` after adding keys.
- Loading / empty / error UI comes from `@/components/states` (`LoadingState`, `EmptyState`, `ErrorState`);
  pass screen-specific `testID`s through. Render errors: `ErrorBoundary` (`@/components/error-boundary`)
  for subtrees; routes get `RouteErrorBoundary` via the root layout's `ErrorBoundary` export.

## CI/CD shape (see PLAN.md decisions 1–3, 12–13)

- GitHub Actions (`.github/workflows/ci.yml`) = JS gate only (lint, typecheck, unit, knip, format, commitlint on the commit range, secret scan, bundle budget, Maestro web).
- `.github/workflows/pr-title.yml` lints the PR title with the same `commitlint.config.js` (the title becomes the squash commit).
- EAS Workflows = native lane (fingerprint → get-build/build → repack → maestro → update → approval → submit).
- `main` → OTA to `staging`; UAT/production are manual, approval-gated promotions of the same update group.

## Queue process

One ticket per PR, branched off `main`, squash-merged immediately, issue closed on merge.
Drive it with `/ship-next`. The ledger is the resumable source of truth; GitHub Issues mirror it.
