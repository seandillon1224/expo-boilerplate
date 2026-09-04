# Execution Queue — expo-boilerplate

**Source of truth for `/ship-next`.** Tracker: GitHub Issues in `seandillon1224/expo-boilerplate`. Plan: `PLAN.md`.

Legend: `[ ]` pending · `[x]` shipped · `[M]` manual/human · `[B]` blocked · `[D]` deferred · `[S]` needs secrets

Rule: one ticket per PR, branch off `main`, squash-merge immediately, close the issue on merge. Fresh subagent per ticket.

## OPEN QUEUE (dependency order)

### E0 — Repo bootstrap and tooling baseline (tracker #67)

- [x] **#1 T0.1** — `git init`, create public GitHub repo, mark as template, MIT license, `.gitignore`, `.node-version`, `bunfig.toml`, Bun-only `preinstall` guard.
- [x] **#2 T0.2** — `create-expo-app` on latest stable SDK with Expo Router; enable New Architecture + React Compiler; typed routes; `app.config.ts` with `APP_VARIANT` driving name/slug/bundle ID/package/icon badge.
- [x] **#3 T0.3** — TypeScript strict, path aliases (`@/`), `expo-env.d.ts`.
- [x] **#4 T0.4** — ESLint 9 flat config (`eslint-config-expo`, simple-import-sort, unused-imports, react-native-a11y), Prettier, `bun run lint` / `format:check`.
- [x] **#5 T0.5** — knip with Expo-aware entries (`app/**`, `*.web.tsx`, `app.config.ts`, config plugins).
- [x] **#6 T0.6** — Lefthook: pre-commit (lint-staged equivalent on changed files), commit-msg (commitlint conventional), pre-push (typecheck).
- [x] **#7 T0.7** — Renovate config: Expo SDK group, patch auto-merge when green, weekly schedule, Bun lockfile support.
- [x] **#8 T0.8** — Jest + jest-expo + RNTL, one component test, coverage config.
- [x] **#9 T0.9** — `.claude/` tooling: `CLAUDE.md` (Expo-tuned), empty `execution-queue.md`, `ship-next` (GitHub-Issues-flavoured), `grill-me`, `repo-audit`, `.claude/settings.json` allowlist.
- [x] **#10 T0.10** — `testID`-required ESLint rule for pressables/inputs (find existing rule or write a local one).

### E1 — Demo app and app-layer infra (tracker #68)

- [x] **#11 T1.1** — NativeWind v5 / Tailwind v4 setup per the `expo-tailwind-setup` guide; theme tokens; dark mode.
- [x] **#12 T1.2** — Layout: native tabs (Home, Settings); Stack inside each.
- [x] **#13 T1.3** — TanStack Query provider + persistence-ready setup; **Fetch screen** hitting a public API with loading/empty/error states.
- [x] **#14 T1.4** — Zod `env` schema + `env-check` script (CLI and startup).
- [x] **#15 T1.5** — i18next with one locale, `i18next-parser` check script.
- [x] **#16 T1.6** — Sentry wired, no-op without DSN; source-map upload hook ready for the update job.
- [x] **#17 T1.7** — `expo-updates` integration: **Updates screen** showing runtime version, channel, update ID, embedded vs OTA, "check for update" button, plus a `useUpdatePolicy` hook stub (filled in by D3).
- [x] **#18 T1.8** — EAS Observe (`expo-observe`) root wrapper + per-route metrics; `markInteractive` on the fetch screen.
- [x] **#19 T1.9** — Error boundary + standard Loading/Empty/Error components.

### E2 — JS gate (GitHub Actions) (tracker #69)

- [x] **#20 T2.1** — `ci.yml`: setup-bun with cache, `bun install --frozen-lockfile`, jobs for lint, typecheck, format, knip, unit (with JUnit + coverage artifacts), concurrency cancel-in-progress.
- [x] **#21 T2.2** — PR title conventional-commit check; commitlint on push.
- [x] **#22 T2.3** — Secret scan (gitleaks) job.
- [x] **#23 T2.4** — `expo export --platform web` + bundle budget check (`bundle-budget.json`, per-platform); iOS/Android JS-only export budgets.
- [x] **#24 T2.5** — Maestro web: serve the static export, run `.maestro` web-tagged flows, JUnit report + screenshots on failure as artifacts.
- [x] **#25 T2.6** — Reassure perf tests job with baseline compare on PR.
- [x] **#26 T2.7** — Renovate auto-merge wiring (required checks, branch protection as code via `gh` script).
- [x] **#27 T2.8** — Required-checks doc: which checks gate merge, how EAS checks appear on the PR.

### E3 — EAS foundation (tracker #70)

- [x] **#28 T3.1** — `eas init`, `eas.json`: profiles `development`, `staging`, `uat`, `production`, plus `e2e-ios-sim` and `e2e-android-apk` (release-mode simulator/APK builds for Maestro). `appVersionSource: remote`.
- [x] **#29 T3.2** — EAS Environment Variables for `development`/`preview`/`production`; `bun run env:pull`; document the mapping to staging/UAT/prod.
- [x] **#30 T3.3** — Update channels `staging`, `uat`, `production`; `runtimeVersion` policy = `fingerprint`.
- [x] **#31 T3.4** — Credentials: iOS + Android signing on EAS for the boilerplate's own bundle IDs. _Android keystores done; iOS + Play credentials are owner steps (docs/environments-and-secrets.md → Credentials)._
- [x] **#32 T3.5** — Device onboarding: `bun run devices:add` (wraps `eas device:create`), `apple-device-registration-request` job, docs for non-engineers.
- [x] **#33 T3.6** — Local reproduce scripts in Bun: `bun run fingerprint`, `bun run e2e:build`, `bun run e2e:repack`, `bun run e2e:ios|android` — same steps the workflows run, for laptop debugging.

### E4 — Native E2E lane (EAS Workflows) (tracker #71)

- [x] **#34 T4.1** — `.maestro/` layout: `config.yaml`, `flows/` (smoke, tabs, fetch, updates), `subflows/launch`, platform tags (`ios`, `android`, `web`), `APP_ID` env.
- [x] **#35 T4.2** — `e2e.yml` workflow: `fingerprint` → `get-build` (by fingerprint + profile) → conditional `build` → `repack` → `maestro` (both platforms, sharding, retries, `record_screen`, JUnit).
- [x] **#36 T4.3** — `github-comment` job posting results, QR codes for the dev/preview builds, links to recordings.
- [x] **#37 T4.4** — Failure artifacts: recordings, Maestro logs, device logs; document how to pull them from the dashboard.
- [x] **#38 T4.5** — Tiered mode input (`ios: always|main-only|label`) documented and wired.
- [x] **#39 T4.6** — Flake budget: retries policy, quarantine tag, and a "flaky flow" issue template.

### E5 — Delivery ladder (tracker #72)

- [x] **#40 T5.1** — `deploy-staging.yml`: on push to `main`, `fingerprint` → `get-build` (staging profile, both platforms) → on miss `build` staging internal builds → `update` to `staging` with Sentry source maps → `deploy` web export to EAS Hosting staging alias → `slack` with install links/QR, flagged "reinstall required" when a new build was made.
- [~] **#41 T5.2** — `promote.yml` (manual): `require-approval` → fingerprint gate: UAT auto-builds its variant on a fingerprint miss; production **refuses** on a miss with a pointer to `release.yml` → republish the chosen update group to `uat` or `production`; promote web alias; GitHub Environments with required reviewers.
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
- 2026-09-03 — E0 shipped: #1–#3 (direct on empty main), #4 PR #77, #5 PR #78, #6 PR #79, #7 PR #80, #8 PR #81, #9 PR #82, #10 PR #83.
  Lessons: ESLint must stay ^9 (v10 breaks eslint-plugin-react via expo config); RNTL v14 render is async;
  TS 6 needs explicit `types: ["jest"]`; `expo-env.d.ts` is generated by `expo start`, CI writes it via scripts/ensure-expo-env.js.
- 2026-09-03 — #11 | t11-nativewind-tailwind | https://github.com/seandillon1224/expo-boilerplate/pull/84 | merged | 2026-09-03
- 2026-09-03 — #12 | t12-native-tabs | https://github.com/seandillon1224/expo-boilerplate/pull/85 | merged | 2026-09-03
- 2026-09-03 — #13 | t13-tanstack-query-fetch | https://github.com/seandillon1224/expo-boilerplate/pull/86 | merged | 2026-09-03
- 2026-09-03 — #14 | t14-zod-env | https://github.com/seandillon1224/expo-boilerplate/pull/87 | merged | 2026-09-03
- 2026-09-03 — #15 | t15-i18next | https://github.com/seandillon1224/expo-boilerplate/pull/88 | merged | 2026-09-03
- 2026-09-03 — #16 | t16-sentry | https://github.com/seandillon1224/expo-boilerplate/pull/89 | merged | 2026-09-03 (human owes: Sentry DSN + SENTRY_ORG/PROJECT/AUTH_TOKEN in EAS env, SENTRY_AUTH_TOKEN GitHub secret)
- 2026-09-03 — #17 | t17-expo-updates | https://github.com/seandillon1224/expo-boilerplate/pull/90 | merged | 2026-09-03 (EAS_UPDATE_URL later superseded by #28)
- 2026-09-03 — #18 | t18-eas-observe | https://github.com/seandillon1224/expo-boilerplate/pull/91 | merged | 2026-09-03 (silent until eas init #28 sets projectId)
- 2026-09-03 — #19 | t19-error-boundary-states | https://github.com/seandillon1224/expo-boilerplate/pull/92 | merged | 2026-09-03 — E1 complete
- 2026-09-03 — #20 | t20-ci-workflow | https://github.com/seandillon1224/expo-boilerplate/pull/93 | merged | 2026-09-03
- 2026-09-03 — #21 | t21-pr-title-commitlint | https://github.com/seandillon1224/expo-boilerplate/pull/94 | merged | 2026-09-03
- 2026-09-03 — #22 | t22-gitleaks | https://github.com/seandillon1224/expo-boilerplate/pull/95 | merged | 2026-09-03
- 2026-09-03 — #23 | t23-bundle-budget | https://github.com/seandillon1224/expo-boilerplate/pull/96 | merged | 2026-09-03
- 2026-09-03 — #24 | t24-maestro-web | https://github.com/seandillon1224/expo-boilerplate/pull/97 | merged | 2026-09-03 (paused after this; local Maestro CLI needs upgrade to >=2.9; #34 note: a `url:` header always makes a flow web-only)
- 2026-09-03 — #25 | t25-reassure | https://github.com/seandillon1224/expo-boilerplate/pull/98 | merged | 2026-09-03
- 2026-09-03 — #26 | t26-branch-protection | https://github.com/seandillon1224/expo-boilerplate/pull/99 | merged | 2026-09-03 (protection applied via repo:settings:apply after user approval; 14 required checks, strict=false, admins not enforced)
- 2026-09-03 — #27 | t27-required-checks-doc | https://github.com/seandillon1224/expo-boilerplate/pull/100 | merged | 2026-09-03 — E2 complete
- 2026-09-03 — #28 | t28-eas-init-profiles | https://github.com/seandillon1224/expo-boilerplate/pull/101 | merged | 2026-09-03 (eas init run by orchestrator; project 885fa7d0-e079-4722-bafa-e05da702b132; human owes: upgrade global eas-cli to >=23)
- 2026-09-03 — #29 | t29-eas-env | https://github.com/seandillon1224/expo-boilerplate/pull/102 | merged | 2026-09-03 (human owes: Sentry vars via eas env:set, EXPO_TOKEN + SENTRY_AUTH_TOKEN GitHub secrets)
- 2026-09-03 — #30 | t30-update-channels | https://github.com/seandillon1224/expo-boilerplate/pull/103 | merged | 2026-09-03 (channels staging/uat/production created; note: package.json scripts are a fingerprint source)
- 2026-09-03 — #31 | t31-credentials | https://github.com/seandillon1224/expo-boilerplate/pull/104 | merged | 2026-09-03 (4 Android keystores on EAS; human owes iOS ad hoc/App Store creds, ASC API key, Play service account)
- 2026-09-03 — #32 | t32-device-onboarding | https://github.com/seandillon1224/expo-boilerplate/pull/105 | merged | 2026-09-03 (account has two Apple teams: LT39NG6Z8B, B8SZSHYJL3 — human picks; ASC API key owed)
- 2026-09-03 — #33 | t33-e2e-local-scripts | https://github.com/seandillon1224/expo-boilerplate/pull/106 | merged | 2026-09-03 — E3 complete (human owes: one paid e2e-ios-sim + e2e-android-apk build to validate repack path)
- 2026-09-03 — #34 | t34-maestro-layout | https://github.com/seandillon1224/expo-boilerplate/pull/107 | merged | 2026-09-03 (iOS 4/4 verified locally; Android tab selector label-based, unverified; invoke `maestro test .maestro` at workspace root)
- 2026-09-03 — #35 | t35-e2e-workflow | https://github.com/seandillon1224/expo-boilerplate/pull/108 | merged | 2026-09-03 (validated, not executed; human owes: link Expo GitHub App, first run = 2 paid builds, then add EAS check context to REQUIRED_CHECKS)
- 2026-09-03 — #36 | t36-github-comment | https://github.com/seandillon1224/expo-boilerplate/pull/109 | merged | 2026-09-03 (validated, not executed; github-comment has no update-in-place; expo.dev URL prefix hardcoded for init to rewrite)
- 2026-09-03 — #37 | t37-failure-artifacts | https://github.com/seandillon1224/expo-boilerplate/pull/110 | merged | 2026-09-03 (e2e.yml at 14.5 KiB of 16 KiB cap — watch size in #38/#39)
- 2026-09-03 — #38 | t38-tiered-mode | https://github.com/seandillon1224/expo-boilerplate/pull/111 | merged | 2026-09-03 (label e2e:ios created; #55 should add it to DESIRED labels)
- 2026-09-03 — #39 | t39-flake-budget | https://github.com/seandillon1224/expo-boilerplate/pull/112 | merged | 2026-09-03 — E4 complete (labels flaky-flow, e2e created; #55 to absorb)
- 2026-09-03 — #40 | t40-deploy-staging | https://github.com/seandillon1224/expo-boilerplate/pull/113 | merged | 2026-09-03 (needs-secrets: HOSTING/IOS_BUILDS constants default disabled; Slack via custom steps job; human owes webhook, first eas deploy, iOS creds, Sentry vars)
