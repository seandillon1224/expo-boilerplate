---
layout: home
title: Docs
hero:
  name: Docs
  text: An opinionated Expo app with the delivery pipeline already wired.
  tagline: A JS gate on GitHub Actions, native Maestro E2E and a staging → UAT → production release ladder on EAS Workflows, web on EAS Hosting with PR previews, and performance tooling from dev to prod. Bun only, Expo SDK 57, New Architecture, CNG only.
  actions:
    - theme: brand
      text: Quick start
      link: /template-init
    - theme: alt
      text: Pipeline
      link: /ci-overview
    - theme: alt
      text: Release ladder
      link: /release-ladder
features:
  - title: App
    details: Expo Router (typed routes), NativeWind v5 / Tailwind v4, TanStack Query (persisted), Zod-validated env, i18next with typed keys, Sentry, EAS Observe, expo-updates behind one hook, shared states and error boundaries.
    link: /environments-and-secrets
    linkText: Environments and secrets
  - title: Quality
    details: oxlint + ESLint 9 flat config (import sort, unused imports, RN a11y, a testID rule), Prettier, knip, commitlint + PR-title check, Lefthook hooks, Jest + RNTL, gitleaks, Renovate.
    link: /js-gate
    linkText: JS gate
  - title: E2E
    details: One Maestro workspace with shared steps and thin web / native entries; web flows in the JS gate, iOS + Android flows on EAS Workflows from a fingerprint-matched build repacked with the PR's JS.
    link: /native-e2e
    linkText: Native E2E
  - title: Delivery
    details: Four APP_VARIANTs from one app.config.ts; EAS Build keyed by fingerprint; OTA to staging on every merge, approval-gated promotion to uat and production; EAS Hosting on the same ladder; store release on a vX.Y.Z tag.
    link: /release-ladder
    linkText: Release ladder
  - title: Perf
    details: Rozenite DevTools in dev builds, Expo Atlas for bundle composition, gzip bundle budgets in CI, Reassure render-perf compare on every PR, EAS Observe TTI budget for a staging soak.
    link: /performance
    linkText: Performance
  - title: Template
    details: Toolchain doctor with install hints, repo:settings to push branch protection and merge settings, and an init script that rewrites every identifier and removes itself, checked end to end in CI.
    link: /doctor
    linkText: Toolchain check
---

## Where to start

[CI overview](ci-overview.md) is the map of the pipeline — every GitHub Actions job and EAS
workflow, what triggers it, what it needs, the repo constants that keep owner-dependent jobs
skipped, and where to look when one is red. The [release ladder](release-ladder.md) is the runbook
from a merge to the stores, and [Commands](commands.md) is every script with its flags.
