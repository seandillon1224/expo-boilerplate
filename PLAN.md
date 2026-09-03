# Expo Boilerplate — Build Plan

Grilled and agreed 2026-09-03. This is the source of truth for the epics and tickets that build the
boilerplate. Tickets get mirrored into GitHub Issues once the repo exists; the ledger that drives
`/ship-next` lives in `.claude/execution-queue.md`.

## Goal

A public GitHub **template repository** for Expo apps, Bun-only, with a CI/CD pipeline that is
proven on the boilerplate itself (a live, paid EAS project). Every future project starts by clicking
"Use this template" and running `bun run init`.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | CI orchestration | **GitHub Actions** for the JS gate; **EAS Workflows** for the native lane (fingerprint → get-build/build → repack → maestro → update → approval → submit). EAS reports checks back to the PR. |
| 2 | Base builds | Produced by **EAS Build**, keyed by `@expo/fingerprint`. CI never runs Metro. |
| 3 | Branching / environments | Trunk-based. `main` → auto OTA to `staging`. `uat` and `production` are manual, approval-gated republishes of the same update group. Three installable app variants via `APP_VARIANT`. Store builds on version tag. |
| 4 | Packaging | Public GitHub template repo + self-deleting `bun run init` script. Boilerplate dogfoods its own pipeline on a real EAS project. |
| 5 | App scaffold | Opinionated infra, thin product. Expo Router (typed routes), NativeWind v5 / Tailwind v4, TanStack Query, Zod, i18next, Sentry (errors, off until DSN), EAS Observe (perf), `expo-updates` with a policy hook. Demo: home tab, settings tab, updates screen, one fetch screen. No auth/backend/forms. |
| 6 | Tests | **Jest + jest-expo + RNTL** for unit/component. **Maestro** for E2E on iOS, Android, and web. No Playwright. |
| 7 | Performance | Now: Rozenite (Query + network plugins), expo-atlas, Reassure, per-platform bundle budgets. Later epic: Flashlight. Prod telemetry: EAS Observe; Sentry perf tracing off. |
| 8 | Code quality | ESLint 9 flat + `eslint-config-expo` + import-sort + unused-imports + RN a11y; Prettier; knip; Lefthook; commitlint (Conventional Commits) + PR-title check; Renovate (grouped Expo SDK, patch auto-merge). |
| 9 | Config / secrets | **EAS Environment Variables** are the source of truth (`development`/`preview`/`production` ↔ staging/UAT/prod). `eas env:pull` locally and in CI. GitHub secrets hold only `EXPO_TOKEN`, Sentry auth token. Zod `env-check` at startup and in CI. |
| 10 | Web | First-class. `expo export --platform web` in the JS gate, Maestro web against the static export, **EAS Hosting** deploy on the same three-environment ladder with PR previews. API routes / SSR opt-in only. |
| 11 | Tracking | GitHub Issues + Project board. `.claude/` ships the ledger, `ship-next`, `grill-me`, `repo-audit` skills and an Expo-tuned `CLAUDE.md`. |
| 12 | Build sharing | Staging/UAT variants = **EAS internal distribution** (hosted install page + QR; iOS ad hoc with self-serve device registration). Production RCs = TestFlight internal group + Play internal track via the release workflow. Engineers use Expo Orbit. No Firebase App Distribution. Install links posted by `slack` and `github-comment` jobs. |
| 13 | Fingerprint change on `main` | `deploy-staging` runs `fingerprint` → `get-build`; on miss it auto-builds staging internal builds for both platforms, then publishes the update and posts "reinstall required" links. UAT builds only at promotion time. Promotion to production with a changed fingerprint is refused; go through the store release workflow. |
| 14 | Defaults | Latest stable SDK, CNG only (no committed `ios/`/`android/`), New Architecture on, React Compiler on. README + `docs/*.md`, no docs site. No Storybook. `testID` lint rule. MIT. Node pinned via `.node-version` for tools; all scripts run via Bun. Both Maestro platforms on every PR (tiered mode as a workflow input). |

## Deferred deep dives (each = research ticket → grill session → its own epic)

- **D1 Release mechanics:** release-please fit, version/build-number strategy, changelog, tag → store workflow.
- **D2 Multi-runtime OTA backports:** shipping OTA-safe commits to N previous store runtime versions for parity with the long tail.
- **D3 Update policies:** forced vs opt-in vs silent updates using `expo-updates` controls, rollout %, `update-rollout`, and the updates screen as test bed.
- **D4 Flashlight** in the Android E2E lane.
- **D5 oxlint** as a fast first pass in front of ESLint.
- **D6 Accessibility E2E:** a Maestro flow with the screen reader enabled.
- **D7 Maestro Cloud** as an optional job for projects that want device farms.

---

## Epics and tickets

Order is dependency order. Ticket IDs are provisional until mirrored to GitHub Issues.

### E0 — Repo bootstrap and tooling baseline
Goal: an empty-but-complete Expo app that lints, typechecks, and tests locally under Bun.

- **T0.1** `git init`, create public GitHub repo, mark as template, MIT license, `.gitignore`, `.node-version`, `bunfig.toml`, Bun-only `preinstall` guard.
- **T0.2** `create-expo-app` on latest stable SDK with Expo Router; enable New Architecture + React Compiler; typed routes; `app.config.ts` with `APP_VARIANT` driving name/slug/bundle ID/package/icon badge.
- **T0.3** TypeScript strict, path aliases (`@/`), `expo-env.d.ts`.
- **T0.4** ESLint 9 flat config (`eslint-config-expo`, simple-import-sort, unused-imports, react-native-a11y), Prettier, `bun run lint` / `format:check`.
- **T0.5** knip with Expo-aware entries (`app/**`, `*.web.tsx`, `app.config.ts`, config plugins).
- **T0.6** Lefthook: pre-commit (lint-staged equivalent on changed files), commit-msg (commitlint conventional), pre-push (typecheck).
- **T0.7** Renovate config: Expo SDK group, patch auto-merge when green, weekly schedule, Bun lockfile support.
- **T0.8** Jest + jest-expo + RNTL, one component test, coverage config.
- **T0.9** `.claude/` tooling: `CLAUDE.md` (Expo-tuned), empty `execution-queue.md`, `ship-next` (GitHub-Issues-flavoured), `grill-me`, `repo-audit`, `.claude/settings.json` allowlist.
- **T0.10** `testID`-required ESLint rule for pressables/inputs (find existing rule or write a local one).

### E1 — Demo app and app-layer infra
Goal: enough real UI for Maestro, perf tooling, and OTA experiments.

- **T1.1** NativeWind v5 / Tailwind v4 setup per the `expo-tailwind-setup` guide; theme tokens; dark mode.
- **T1.2** Layout: native tabs (Home, Settings); Stack inside each.
- **T1.3** TanStack Query provider + persistence-ready setup; **Fetch screen** hitting a public API with loading/empty/error states.
- **T1.4** Zod `env` schema + `env-check` script (CLI and startup).
- **T1.5** i18next with one locale, `i18next-parser` check script.
- **T1.6** Sentry wired, no-op without DSN; source-map upload hook ready for the update job.
- **T1.7** `expo-updates` integration: **Updates screen** showing runtime version, channel, update ID, embedded vs OTA, "check for update" button, plus a `useUpdatePolicy` hook stub (filled in by D3).
- **T1.8** EAS Observe (`expo-observe`) root wrapper + per-route metrics; `markInteractive` on the fetch screen.
- **T1.9** Error boundary + standard Loading/Empty/Error components.

### E2 — JS gate (GitHub Actions)
Goal: every PR gets a < 5 minute verdict on everything that doesn't need a simulator.

- **T2.1** `ci.yml`: setup-bun with cache, `bun install --frozen-lockfile`, jobs for lint, typecheck, format, knip, unit (with JUnit + coverage artifacts), concurrency cancel-in-progress.
- **T2.2** PR title conventional-commit check; commitlint on push.
- **T2.3** Secret scan (gitleaks) job.
- **T2.4** `expo export --platform web` + bundle budget check (`bundle-budget.json`, per-platform); iOS/Android JS-only export budgets.
- **T2.5** Maestro web: serve the static export, run `.maestro` web-tagged flows, JUnit report + screenshots on failure as artifacts.
- **T2.6** Reassure perf tests job with baseline compare on PR.
- **T2.7** Renovate auto-merge wiring (required checks, branch protection as code via `gh` script).
- **T2.8** Required-checks doc: which checks gate merge, how EAS checks appear on the PR.

### E3 — EAS foundation
Goal: the boilerplate is a real EAS project with environments and profiles ready for workflows.

- **T3.1** `eas init`, `eas.json`: profiles `development`, `staging`, `uat`, `production`, plus `e2e-ios-sim` and `e2e-android-apk` (release-mode simulator/APK builds for Maestro). `appVersionSource: remote`.
- **T3.2** EAS Environment Variables for `development`/`preview`/`production`; `bun run env:pull`; document the mapping to staging/UAT/prod.
- **T3.3** Update channels `staging`, `uat`, `production`; `runtimeVersion` policy = `fingerprint`.
- **T3.4** Credentials: iOS + Android signing on EAS for the boilerplate's own bundle IDs.
- **T3.5** Device onboarding: `bun run devices:add` (wraps `eas device:create`), `apple-device-registration-request` job, docs for non-engineers.
- **T3.6** Local reproduce scripts in Bun: `bun run fingerprint`, `bun run e2e:build`, `bun run e2e:repack`, `bun run e2e:ios|android` — same steps the workflows run, for laptop debugging.

### E4 — Native E2E lane (EAS Workflows)
Goal: every PR runs Maestro on iOS and Android against a repacked release build, with reports and recordings.

- **T4.1** `.maestro/` layout: `config.yaml`, `flows/` (smoke, tabs, fetch, updates), `subflows/launch`, platform tags (`ios`, `android`, `web`), `APP_ID` env.
- **T4.2** `e2e.yml` workflow: `fingerprint` → `get-build` (by fingerprint + profile) → conditional `build` → `repack` → `maestro` (both platforms, sharding, retries, `record_screen`, JUnit).
- **T4.3** `github-comment` job posting results, QR codes for the dev/preview builds, links to recordings.
- **T4.4** Failure artifacts: recordings, Maestro logs, device logs; document how to pull them from the dashboard.
- **T4.5** Tiered mode input (`ios: always|main-only|label`) documented and wired.
- **T4.6** Flake budget: retries policy, quarantine tag, and a "flaky flow" issue template.

### E5 — Delivery ladder
Goal: main → staging automatically; UAT and production by approval; stores on tag; web on the same ladder.

- **T5.1** `deploy-staging.yml`: on push to `main`, `fingerprint` → `get-build` (staging profile, both platforms) → on miss `build` staging internal builds → `update` to `staging` with Sentry source maps → `deploy` web export to EAS Hosting staging alias → `slack` with install links/QR, flagged "reinstall required" when a new build was made.
- **T5.2** `promote.yml` (manual): `require-approval` → fingerprint gate: UAT auto-builds its variant on a fingerprint miss; production **refuses** on a miss with a pointer to `release.yml` → republish the chosen update group to `uat` or `production`; promote web alias; GitHub Environments with required reviewers.
- **T5.3** `release.yml`: on `v*` tag, `build` production for both platforms, `submit` to Play internal track, `testflight` internal group; refuses/skips with a clear message when the fingerprint hasn't changed since the last store release.
- **T5.4** PR preview web deploys with unique URLs in the PR comment.
- **T5.5** Fingerprint-drift check on PRs: comment when a PR changes the native fingerprint ("this needs a store release").
- **T5.6** Build-sharing surfaces: Slack channel wiring, Orbit setup doc, "how a designer installs the staging app" one-pager.
- **T5.7** Runbook: `docs/release-ladder.md` covering the full path, rollback (`eas update:republish` / `update:rollback`), and channel/branch mapping.

### E6 — Performance tooling
Goal: dev-time, CI, and prod layers all present with seed usage.

- **T6.1** Rozenite host + TanStack Query, network, performance plugins; docs on adding a project plugin.
- **T6.2** expo-atlas wiring + `bun run atlas`.
- **T6.3** Reassure baseline + two seed tests (already in gate via T2.6; this ticket owns setup).
- **T6.4** EAS Observe verification: query `eas observe:metrics-summary` post-deploy; document gating on TTI.
- **T6.5** Performance doc: what each layer answers and where to look.

### E7 — Template init script
Goal: one command turns the template into a new project.

- **T7.1** `bun run init`: prompts for name, slug, bundle ID, package, EAS project ID, scheme; rewrites `app.config.ts`, `eas.json`, `.maestro/config.yaml` + flow envs, workflow YAML, README badges, `package.json` name.
- **T7.2** Toolchain check: Bun version, EAS CLI login, Maestro, Xcode, Android SDK, Java; prints fix hints.
- **T7.3** Resets `.claude/execution-queue.md`, clears CHANGELOG, fresh git history option, self-deletes.
- **T7.4** Template-repo settings script (`gh`): branch protection, required checks, environments, labels.
- **T7.5** End-to-end test: spawn a throwaway project from the template in CI and run the JS gate on it.

### E8 — Docs
- **T8.1** README: what's inside, quick start, the pipeline diagram, "commonly added next".
- **T8.2** `docs/`: ci-overview, js-gate, native-e2e, release-ladder, environments-and-secrets, performance, testing, conventions.
- **T8.3** ADR folder with the decisions table above as ADR-0001.

### E9 — Deferred deep-dive research tickets
Each produces a short findings doc and triggers a grill session before any implementation epic is cut.

- **T9.1** D1 release-please + versioning.
- **T9.2** D2 multi-runtime OTA backports.
- **T9.3** D3 update policies (forced / opt-in / silent).
- **T9.4** D4 Flashlight.
- **T9.5** D5 oxlint.
- **T9.6** D6 a11y Maestro flow.
- **T9.7** D7 Maestro Cloud optional job.

## Sequencing

E0 → E1 → E2 and E3 in parallel → E4 → E5 → E6 → E7 → E8. E9 research tickets can run any time after
E4 lands, since D2 and D3 need a working update pipeline to experiment against.

## Definition of done for the boilerplate v1

- A PR on the boilerplate repo shows green JS gate, green iOS + Android Maestro from a repacked build, a
  web preview URL, and QR codes, with no human intervention.
- Merge to main lands an OTA on staging and a web deploy within the same run.
- A manual promotion to production is approval-gated and republishes the exact staging bytes.
- `bun run init` on a fresh copy produces a project whose JS gate passes on its first commit.
