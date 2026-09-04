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
- [Getting the staging app on your iPhone](docs/device-onboarding.md) — device registration for testers (plain language) and the engineer side (`bun run devices:add`, the `Register test device` workflow, rebuild after).
