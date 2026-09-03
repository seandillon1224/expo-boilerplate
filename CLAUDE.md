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
- Full local gate before a PR: `bun run lint && bun run typecheck && bun run test && bun run knip`

## Conventions

- **Conventional Commits** are enforced by commitlint (commit-msg hook) and the PR-title check.
  Subject must be lowercase; PR titles become the squash commit message.
- Lefthook runs eslint/prettier on staged files (pre-commit) and typecheck + knip (pre-push).
- Source lives in `src/`; routes in `src/app/` (Expo Router, typed routes on). Path alias `@/` → `src/`.
- `app.config.ts` derives name / bundle id / package / scheme from `APP_VARIANT`
  (`development` | `staging` | `uat` | `production`). Never hardcode identifiers elsewhere.
- CNG only: never commit `ios/` or `android/`. Native changes go through config plugins.
- Every pressable / input gets a `testID` (lint-enforced) — Maestro flows never select by text.
- `@testing-library/react-native` v14: `render`, `rerender`, `unmount` are **async** — `await` them.
- TypeScript 6: `@types/*` are not auto-included; add to `types` in `tsconfig.json`.

## CI/CD shape (see PLAN.md decisions 1–3, 12–13)

- GitHub Actions = JS gate only (lint, typecheck, unit, knip, format, secret scan, bundle budget, Maestro web).
- EAS Workflows = native lane (fingerprint → get-build/build → repack → maestro → update → approval → submit).
- `main` → OTA to `staging`; UAT/production are manual, approval-gated promotions of the same update group.

## Queue process

One ticket per PR, branched off `main`, squash-merged immediately, issue closed on merge.
Drive it with `/ship-next`. The ledger is the resumable source of truth; GitHub Issues mirror it.
