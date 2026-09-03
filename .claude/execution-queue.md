# Execution Queue — expo-boilerplate

**Source of truth for `/ship-next`.** Tracker: GitHub Issues in `seandillon1224/expo-boilerplate`. Plan: `PLAN.md`.

Legend: `[ ]` pending · `[x]` shipped · `[M]` manual/human · `[B]` blocked · `[D]` deferred · `[S]` needs secrets

Rule: one ticket per PR, branch off `main`, squash-merge immediately, close the issue on merge. Fresh subagent per ticket.

## OPEN QUEUE (dependency order)

### E0 — Repo bootstrap and tooling baseline (tracker #67)
- [ ] **#1 T0.1** — `git init`, create public GitHub repo, mark as template, MIT license, `.gitignore`, `.node-version`, `bunfig.toml`, Bun-only `preinstall` guard.
- [ ] **#2 T0.2** — `create-expo-app` on latest stable SDK with Expo Router; enable New Architecture + React Compiler; typed routes; `app.config.ts` with `APP_VARIANT` driving name/slug/bundle ID/package/icon badge.
- [ ] **#3 T0.3** — TypeScript strict, path aliases (`@/`), `expo-env.d.ts`.
- [ ] **#4 T0.4** — ESLint 9 flat config (`eslint-config-expo`, simple-import-sort, unused-imports, react-native-a11y), Prettier, `bun run lint` / `format:check`.
- [ ] **#5 T0.5** — knip with Expo-aware entries (`app/**`, `*.web.tsx`, `app.config.ts`, config plugins).
- [ ] **#6 T0.6** — Lefthook: pre-commit (lint-staged equivalent on changed files), commit-msg (commitlint conventional), pre-push (typecheck).
- [ ] **#7 T0.7** — Renovate config: Expo SDK group, patch auto-merge when green, weekly schedule, Bun lockfile support.
- [ ] **#8 T0.8** — Jest + jest-expo + RNTL, one component test, coverage config.
- [ ] **#9 T0.9** — `.claude/` tooling: `CLAUDE.md` (Expo-tuned), empty `execution-queue.md`, `ship-next` (GitHub-Issues-flavoured), `grill-me`, `repo-audit`, `.claude/settings.json` allowlist.
- [ ] **#10 T0.10** — `testID`-required ESLint rule for pressables/inputs (find existing rule or write a local one).

### E1 — Demo app and app-layer infra (tracker #68)
- [ ] **#11 T1.1** — NativeWind v5 / Tailwind v4 setup per the `expo-tailwind-setup` guide; theme tokens; dark mode.
- [ ] **#12 T1.2** — Layout: native tabs (Home, Settings); Stack inside each.
- [ ] **#13 T1.3** — TanStack Query provider + persistence-ready setup; **Fetch screen** hitting a public API with loading/empty/error states.
- [ ] **#14 T1.4** — Zod `env` schema + `env-check` script (CLI and startup).
- [ ] **#15 T1.5** — i18next with one locale, `i18next-parser` check script.
- [ ] **#16 T1.6** — Sentry wired, no-op without DSN; source-map upload hook ready for the update job.
- [ ] **#17 T1.7** — `expo-updates` integration: **Updates screen** showing runtime version, channel, update ID, embedded vs OTA, "check for update" button, plus a `useUpdatePolicy` hook stub (filled in by D3).
- [ ] **#18 T1.8** — EAS Observe (`expo-observe`) root wrapper + per-route metrics; `markInteractive` on the fetch screen.
- [ ] **#19 T1.9** — Error boundary + standard Loading/Empty/Error components.

### E2 — JS gate (GitHub Actions) (tracker #69)
- [ ] **#20 T2.1** — `ci.yml`: setup-bun with cache, `bun install --frozen-lockfile`, jobs for lint, typecheck, format, knip, unit (with JUnit + coverage artifacts), concurrency cancel-in-progress.
- [ ] **#21 T2.2** — PR title conventional-commit check; commitlint on push.
- [ ] **#22 T2.3** — Secret scan (gitleaks) job.
- [ ] **#23 T2.4** — `expo export --platform web` + bundle budget check (`bundle-budget.json`, per-platform); iOS/Android JS-only export budgets.
- [ ] **#24 T2.5** — Maestro web: serve the static export, run `.maestro` web-tagged flows, JUnit report + screenshots on failure as artifacts.
- [ ] **#25 T2.6** — Reassure perf tests job with baseline compare on PR.
- [ ] **#26 T2.7** — Renovate auto-merge wiring (required checks, branch protection as code via `gh` script).
- [ ] **#27 T2.8** — Required-checks doc: which checks gate merge, how EAS checks appear on the PR.

### E3 — EAS foundation (tracker #70)
- [ ] **#28 T3.1** — `eas init`, `eas.json`: profiles `development`, `staging`, `uat`, `production`, plus `e2e-ios-sim` and `e2e-android-apk` (release-mode simulator/APK builds for Maestro). `appVersionSource: remote`.
- [ ] **#29 T3.2** — EAS Environment Variables for `development`/`preview`/`production`; `bun run env:pull`; document the mapping to staging/UAT/prod.
- [ ] **#30 T3.3** — Update channels `staging`, `uat`, `production`; `runtimeVersion` policy = `fingerprint`.
- [ ] **#31 T3.4** — Credentials: iOS + Android signing on EAS for the boilerplate's own bundle IDs.
- [ ] **#32 T3.5** — Device onboarding: `bun run devices:add` (wraps `eas device:create`), `apple-device-registration-request` job, docs for non-engineers.
- [ ] **#33 T3.6** — Local reproduce scripts in Bun: `bun run fingerprint`, `bun run e2e:build`, `bun run e2e:repack`, `bun run e2e:ios|android` — same steps the workflows run, for laptop debugging.

### E4 — Native E2E lane (EAS Workflows) (tracker #71)
- [ ] **#34 T4.1** — `.maestro/` layout: `config.yaml`, `flows/` (smoke, tabs, fetch, updates), `subflows/launch`, platform tags (`ios`, `android`, `web`), `APP_ID` env.
- [ ] **#35 T4.2** — `e2e.yml` workflow: `fingerprint` → `get-build` (by fingerprint + profile) → conditional `build` → `repack` → `maestro` (both platforms, sharding, retries, `record_screen`, JUnit).
- [ ] **#36 T4.3** — `github-comment` job posting results, QR codes for the dev/preview builds, links to recordings.
- [ ] **#37 T4.4** — Failure artifacts: recordings, Maestro logs, device logs; document how to pull them from the dashboard.
- [ ] **#38 T4.5** — Tiered mode input (`ios: always|main-only|label`) documented and wired.
- [ ] **#39 T4.6** — Flake budget: retries policy, quarantine tag, and a "flaky flow" issue template.

### E5 — Delivery ladder (tracker #72)
- [ ] **#40 T5.1** — `deploy-staging.yml`: on push to `main`, `fingerprint` → `get-build` (staging profile, both platforms) → on miss `build` staging internal builds → `update` to `staging` with Sentry source maps → `deploy` web export to EAS Hosting staging alias → `slack` with install links/QR, flagged "reinstall required" when a new build was made.
- [ ] **#41 T5.2** — `promote.yml` (manual): `require-approval` → fingerprint gate: UAT auto-builds its variant on a fingerprint miss; production **refuses** on a miss with a pointer to `release.yml` → republish the chosen update group to `uat` or `production`; promote web alias; GitHub Environments with required reviewers.
- [ ] **#42 T5.3** — `release.yml`: on `v*` tag, `build` production for both platforms, `submit` to Play internal track, `testflight` internal group; refuses/skips with a clear message when the fingerprint hasn't changed since the last store release.
- [ ] **#43 T5.4** — PR preview web deploys with unique URLs in the PR comment.
- [ ] **#44 T5.5** — Fingerprint-drift check on PRs: comment when a PR changes the native fingerprint ("this needs a store release").
- [ ] **#45 T5.6** — Build-sharing surfaces: Slack channel wiring, Orbit setup doc, "how a designer installs the staging app" one-pager.
- [ ] **#46 T5.7** — Runbook: `docs/release-ladder.md` covering the full path, rollback (`eas update:republish` / `update:rollback`), and channel/branch mapping.

### E6 — Performance tooling (tracker #73)
- [ ] **#47 T6.1** — Rozenite host + TanStack Query, network, performance plugins; docs on adding a project plugin.
- [ ] **#48 T6.2** — expo-atlas wiring + `bun run atlas`.
- [ ] **#49 T6.3** — Reassure baseline + two seed tests (already in gate via T2.6; this ticket owns setup).
- [ ] **#50 T6.4** — EAS Observe verification: query `eas observe:metrics-summary` post-deploy; document gating on TTI.
- [ ] **#51 T6.5** — Performance doc: what each layer answers and where to look.

### E7 — Template init script (tracker #74)
- [ ] **#52 T7.1** — `bun run init`: prompts for name, slug, bundle ID, package, EAS project ID, scheme; rewrites `app.config.ts`, `eas.json`, `.maestro/config.yaml` + flow envs, workflow YAML, README badges, `package.json` name.
- [ ] **#53 T7.2** — Toolchain check: Bun version, EAS CLI login, Maestro, Xcode, Android SDK, Java; prints fix hints.
- [ ] **#54 T7.3** — Resets `.claude/execution-queue.md`, clears CHANGELOG, fresh git history option, self-deletes.
- [ ] **#55 T7.4** — Template-repo settings script (`gh`): branch protection, required checks, environments, labels.
- [ ] **#56 T7.5** — End-to-end test: spawn a throwaway project from the template in CI and run the JS gate on it.

### E8 — Docs (tracker #75)
- [ ] **#57 T8.1** — README: what's inside, quick start, the pipeline diagram, "commonly added next".
- [ ] **#58 T8.2** — `docs/`: ci-overview, js-gate, native-e2e, release-ladder, environments-and-secrets, performance, testing, conventions.
- [ ] **#59 T8.3** — ADR folder with the decisions table above as ADR-0001.

### E9 — Deferred deep-dive research tickets (tracker #76)
- [D] **#60 T9.1** — D1 release-please + versioning.
- [D] **#61 T9.2** — D2 multi-runtime OTA backports.
- [D] **#62 T9.3** — D3 update policies (forced / opt-in / silent).
- [D] **#63 T9.4** — D4 Flashlight.
- [D] **#64 T9.5** — D5 oxlint.
- [D] **#65 T9.6** — D6 a11y Maestro flow.
- [D] **#66 T9.7** — D7 Maestro Cloud optional job.

## RUN LOG

- 2026-09-03 — Repo created, 66 tickets + 10 epic trackers filed from PLAN.md.
