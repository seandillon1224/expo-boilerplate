# Expo Boilerplate

[![CI](https://github.com/seandillon1224/expo-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/seandillon1224/expo-boilerplate/actions/workflows/ci.yml)

Opinionated Expo template: Bun-only, EAS Workflows native lane, GitHub Actions JS gate, Maestro E2E on iOS, Android and web.

> Work in progress. See `PLAN.md` for the design and the epic/ticket breakdown.

## Quick start

```sh
bun install
bun run ios    # or android / web
```

## Docs

- [JS gate: required checks](docs/js-gate.md) — what gates merge, how merging works, running the gate locally.
- [Environments and secrets](docs/environments-and-secrets.md) — EAS build profiles (`eas.json`) and, from T3.2, environment variables.
- [Native E2E (iOS / Android)](docs/native-e2e.md) — reproducing the EAS Workflows native lane locally: `bun run e2e:build`, `e2e:repack`, `e2e:ios` / `e2e:android`.
- [Release ladder](docs/release-ladder.md) — the runbook: PR previews → `main` → staging (automatic) → UAT → production (approval-gated promotions) → store release on a `vX.Y.Z` tag; channel / branch / variant mapping, rollback per channel (`eas update:rollback` / `update:republish` / roll-back-to-embedded), hotfix path.
- [Getting the staging app on your iPhone](docs/device-onboarding.md) — device registration for testers (plain language) and the engineer side (`bun run devices:add`, the `Register test device` workflow, rebuild after).
- [Build sharing](docs/build-sharing.md) — where install links come from (install page, Slack `slack` jobs, PR comments, TestFlight / Play internal), `SLACK_WEBHOOK_URL` wiring, Expo Orbit for engineers.
- [Rozenite DevTools](docs/rozenite.md) — React Native DevTools plugins in dev builds (TanStack Query, network activity, performance monitor), how to open them, and adding a project-local plugin.
- [Render-perf tests (Reassure)](docs/perf-tests.md) — writing `*.perf-test.tsx`, `measureRenders` / `measureFunction`, baseline vs compare locally, what `perf:gate` fails on, reading `.reassure/output.md`.
- [Expo Atlas](docs/atlas.md) — bundle composition per platform (which module pulls what): `bun run atlas` against the dev server, `bun run atlas:export` for a release export; budget = the gate, Atlas = the diagnosis.
- [Installing the staging app](docs/install-staging-app.md) — the no-CLI one-pager for designers / PMs / testers: iOS and Android install, and why "reinstall required" happens.
