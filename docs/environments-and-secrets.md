# Environments and secrets

## Build profiles

`eas.json` is the only place build profiles live; `eas.json` cannot hold comments, so this table is
the commentary. Every profile `extends` the abstract `base` profile (pins `bun` to the version in
`.bun-version`; EAS Build also detects `bun.lock`). `APP_VARIANT` is set per profile and drives the
app name, bundle id / package and scheme in `app.config.ts` (PLAN.md decision 3), so all four variants
install side by side. `appVersionSource: remote` means EAS owns `version` / `buildNumber` /
`versionCode`; `production` auto-increments them on every build.

| Profile                 | `APP_VARIANT` | Distribution | Channel      | Purpose                                                                            | Used by                                                                     |
| ----------------------- | ------------- | ------------ | ------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `development`           | `development` | `internal`   | –            | Dev client for physical devices (Metro on the laptop).                             | Engineers (`eas build --profile development`)                               |
| `development-simulator` | `development` | `internal`   | –            | Same dev client as an iOS simulator build.                                         | Engineers                                                                   |
| `staging`               | `staging`     | `internal`   | `staging`    | Internal-distribution build (install page + QR; iOS ad hoc). Android ships an APK. | `deploy-staging` workflow on fingerprint miss (T4.x); OTA target for `main` |
| `uat`                   | `uat`         | `internal`   | `uat`        | Internal-distribution build for the UAT promotion.                                 | UAT promotion workflow                                                      |
| `production`            | `production`  | `store`      | `production` | Store build (App Store Connect / Play). `autoIncrement: true`.                     | Store release workflow on version tag; `submit.production`                  |
| `e2e-ios-sim`           | `development` | `internal`   | –            | Release-mode iOS **simulator** build; `repack` injects the PR's JS bundle.         | `e2e` workflow + `bun run e2e:build` (T3.6 / T4.2); Maestro                 |
| `e2e-android-apk`       | `development` | `internal`   | –            | Release-mode Android **APK** (`:app:assembleRelease`); `repack` injects the JS.    | `e2e` workflow + `bun run e2e:build` (T3.6 / T4.2); Maestro                 |

Notes:

- The `e2e-*` profiles have no `channel` on purpose: the build is a native shell keyed by
  `@expo/fingerprint` and never checks for updates; the JS under test is repacked in (T4.2).
- Channels `staging` / `uat` / `production` are created server-side by T3.3; naming them here is
  just a string on the build.
- `submit.production` is intentionally minimal (`android.track: internal`; iOS empty). Apple / Play
  credentials and `ascAppId` / `appleTeamId` / service-account key are configured in T3.4 (#31) and
  T5.x, not committed here.
- The EAS project id (`885fa7d0-…`) lives once, in `app.config.ts` (`EAS_PROJECT_ID`), feeding both
  `extra.eas.projectId` and `updates.url`. `bun run init` (T7.1) rewrites it for a new app.

## Environment variables

See T3.2 (#29) — EAS Environment Variables (`development` / `preview` / `production`), `bun run
env:pull`, and the mapping to the staging / UAT / production variants.
