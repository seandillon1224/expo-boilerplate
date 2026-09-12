# ADR-0001: Locked architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-03
- **Issue:** #59

## Context

The template is an opinionated Expo starter, Bun-only, whose CI/CD pipeline is proven on the
template itself (a live, paid EAS project). Before any code was written the design was grilled in a
single session on 2026-09-03 and fourteen decisions were locked; the build plan (`PLAN.md`) and
every doc cite them by number as "PLAN.md decision N". This record captures that table so the
reasoning has a home that outlives the plan.

## Decision

| #   | Decision                     | Choice                                                                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI orchestration             | **GitHub Actions** for the JS gate; **EAS Workflows** for the native lane (fingerprint → get-build/build → repack → maestro → update → approval → submit). EAS reports checks back to the PR.                                                                                                                                                  |
| 2   | Base builds                  | Produced by **EAS Build**, keyed by `@expo/fingerprint`. CI never runs Metro.                                                                                                                                                                                                                                                                  |
| 3   | Branching / environments     | Trunk-based. `main` → auto OTA to `staging`. `uat` and `production` are manual, approval-gated republishes of the same update group. Three installable app variants via `APP_VARIANT`. Store builds on version tag.                                                                                                                            |
| 4   | Packaging                    | Public GitHub template repo + self-deleting `bun run init` script. Boilerplate dogfoods its own pipeline on a real EAS project.                                                                                                                                                                                                                |
| 5   | App scaffold                 | Opinionated infra, thin product. Expo Router (typed routes), NativeWind v5 / Tailwind v4, TanStack Query, Zod, i18next, Sentry (errors, off until DSN), EAS Observe (perf), `expo-updates` with a policy hook. Demo: home tab, settings tab, updates screen, one fetch screen. No auth/backend/forms.                                          |
| 6   | Tests                        | **Jest + jest-expo + RNTL** for unit/component. **Maestro** for E2E on iOS, Android, and web. No Playwright.                                                                                                                                                                                                                                   |
| 7   | Performance                  | Now: Rozenite (Query + network plugins), expo-atlas, Reassure, per-platform bundle budgets. Later epic: Flashlight. Prod telemetry: EAS Observe; Sentry perf tracing off.                                                                                                                                                                      |
| 8   | Code quality                 | ESLint 9 flat + `eslint-config-expo` + import-sort + unused-imports + RN a11y; Prettier; knip; Lefthook; commitlint (Conventional Commits) + PR-title check; Renovate (grouped Expo SDK, patch auto-merge).                                                                                                                                    |
| 9   | Config / secrets             | **EAS Environment Variables** are the source of truth (`development`/`preview`/`production` ↔ staging/UAT/prod). `eas env:pull` locally and in CI. GitHub secrets hold only `EXPO_TOKEN`, Sentry auth token. Zod `env-check` at startup and in CI.                                                                                             |
| 10  | Web                          | First-class. `expo export --platform web` in the JS gate, Maestro web against the static export, **EAS Hosting** deploy on the same three-environment ladder with PR previews. API routes / SSR opt-in only.                                                                                                                                   |
| 11  | Tracking                     | GitHub Issues + Project board. `.claude/` ships the ledger, `ship-next`, `grill-me`, `repo-audit` skills and an Expo-tuned `CLAUDE.md`.                                                                                                                                                                                                        |
| 12  | Build sharing                | Staging/UAT variants = **EAS internal distribution** (hosted install page + QR; iOS ad hoc with self-serve device registration). Production RCs = TestFlight internal group + Play internal track via the release workflow. Engineers use Expo Orbit. No Firebase App Distribution. Install links posted by `slack` and `github-comment` jobs. |
| 13  | Fingerprint change on `main` | `deploy-staging` runs `fingerprint` → `get-build`; on miss it auto-builds staging internal builds for both platforms, then publishes the update and posts "reinstall required" links. UAT builds only at promotion time. Promotion to production with a changed fingerprint is refused; go through the store release workflow.                 |
| 14  | Defaults                     | Latest stable SDK, CNG only (no committed `ios/`/`android/`), New Architecture on, React Compiler on. README + `docs/*.md`, no docs site. No Storybook. `testID` lint rule. MIT. Node pinned via `.node-version` for tools; all scripts run via Bun. Both Maestro platforms on every PR (tiered mode as a workflow input).                     |

## Consequences

- `CLAUDE.md`, `docs/*.md` and the workflow files are written against these decisions; a change to
  one is a new ADR that supersedes the row here, plus the same-PR edit of the table in `PLAN.md`
  ([Conventions → Changing a locked decision](../conventions.md#changing-a-locked-decision)).
- Two CI systems (GitHub Actions for JS, EAS Workflows for native) means two places to look when a
  check is red; [CI overview](../ci-overview.md) is the map.
- Trunk-based delivery with promotion of the same update group makes "what UAT signed off is what
  production gets" a property of the pipeline, at the cost of a store release whenever the native
  fingerprint changes ([Release ladder](../release-ladder.md)).
- A project created with `bun run init` inherits this table unchanged (`PLAN.md` keeps the section);
  decisions the project revisits get their own ADR in this folder.

## Not decided here

The deferred deep dives in `PLAN.md` (D1 release mechanics, D2 multi-runtime OTA backports, D3
update policies, D4 Flashlight, D5 oxlint, D6 accessibility E2E, D7 Maestro Cloud) are open. Each
follows research ticket → grill session → its own ADR when it lands.
