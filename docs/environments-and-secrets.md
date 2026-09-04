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

[EAS Environment Variables](https://docs.expo.dev/eas/environment-variables/) are the source of truth
(PLAN.md decision 9). EAS has three environments — `development`, `preview`, `production` — and we
have four `APP_VARIANT`s, so `preview` is shared by `staging` and `uat`; the build profile's `env`
tells them apart (see [Precedence](#precedence)). Every profile in `eas.json` sets `environment`
explicitly rather than relying on the CLI's inference (`store` → `production`, `developmentClient` →
`development`, else `preview`).

### Environment mapping

| EAS environment | Build profiles                                                           | `APP_VARIANT` (from profile `env`) | Update channel (T3.3) | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `development`   | `development`, `development-simulator`, `e2e-ios-sim`, `e2e-android-apk` | `development`                      | –                     | Dev clients and the release-mode Maestro shells. Also what `bun run env:pull` pulls. |
| `preview`       | `staging`, `uat`                                                         | `staging` / `uat`                  | `staging` / `uat`     | Internal-distribution builds and the `main` → staging → UAT OTA promotions.          |
| `production`    | `production`                                                             | `production`                       | `production`          | Store builds and the production OTA promotion.                                       |

Workflow jobs pick an environment too: `build` jobs infer it from the profile's `environment`,
`submit` inherits it from the build, `maestro` jobs default to `preview`, everything else (including
`update` and `fingerprint`) defaults to `production` — so every non-build job in `.eas/workflows/`
must set `environment:` explicitly to stay in sync with the profile it pairs with. `eas update` and
`eas deploy` take `--environment` (required from SDK 55) and then ignore local `.env*` files.

### Variables

| Name                      | Visibility  | Environments                             | Set by                     | Consumed by                                                                                                             |
| ------------------------- | ----------- | ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`     | `plaintext` | all three (same demo value today)        | Template (created in T3.2) | App via `@/lib/env`; inlined into the JS bundle at build / update / export time.                                        |
| `EXPO_PUBLIC_APP_VARIANT` | `plaintext` | `development` / `staging` / `production` | Template (created in T3.2) | App via `@/lib/env`. **Overridden by the profile `env`** (`uat` builds get `uat` even though `preview` says `staging`). |
| `EXPO_PUBLIC_SENTRY_DSN`  | `plaintext` | all three (may share one DSN)            | **Owner** (see checklist)  | `src/lib/sentry.ts`; absent → Sentry is a no-op.                                                                        |
| `SENTRY_ORG`              | `plaintext` | all three                                | **Owner**                  | `@sentry/react-native/expo` config plugin (EAS Build) and `bun run sentry:sourcemaps` (EAS Update).                     |
| `SENTRY_PROJECT`          | `plaintext` | all three                                | **Owner**                  | Same as `SENTRY_ORG`.                                                                                                   |
| `SENTRY_AUTH_TOKEN`       | `secret`    | all three                                | **Owner**                  | Same as `SENTRY_ORG`; `secret` so it is never readable outside EAS servers and is redacted in job logs.                 |

All variables are `--scope project`. `APP_VARIANT` itself is deliberately **not** an EAS variable: it
is owned by the build profile (`eas.json` → `env`), which is the only thing that distinguishes
`staging` from `uat` inside the shared `preview` environment. Add new `EXPO_PUBLIC_*` keys to
`src/lib/env.schema.ts` and `.env.example` in the same PR that creates them on EAS.

Visibility, per the Expo docs: `plaintext` is visible everywhere (website, CLI, logs); `sensitive` is
readable in the CLI / `env:pull` but obfuscated in build and workflow logs; `secret` is never readable
outside EAS servers — `env:pull` writes it as a commented-out `# NAME=*****` line.

### Precedence

When the same name is defined in more than one place, the one higher in this list wins:

1. Workflow job `env:` (`.eas/workflows/*.yml`).
2. `eas.json` build profile `env` (only for builds — this is why `APP_VARIANT` lives there).
3. EAS environment variables for the job's environment (`environment` in the profile / job).
4. Local `.env*` files — used only by `expo start` / `expo export` / `bun run env:check` on your
   machine. `eas build` uploads your working tree but the cloud job resolves variables from EAS, and
   `eas update --environment` explicitly ignores local `.env` files. Keep them gitignored
   (`.gitignore` already excludes every `.env*` except `.env.example`).

Bun loads `.env`, then `.env.local`, then `.env.<NODE_ENV>`; Expo CLI loads `.env`, `.env.local`,
`.env.<mode>`, `.env.<mode>.local` (later files win). So a hand-written `.env` is a personal override
layer _under_ the pulled `.env.local` — never edit `.env.local` by hand; re-pull it instead.

### Pulling locally

```sh
bun run env:pull             # development → .env.local (default)
bun run env:pull:preview     # or EAS_ENV=preview bun run env:pull
bun run env:pull:production  # or EAS_ENV=production bun run env:pull
bun run env:check            # validates whatever is now in .env / .env.local
```

`eas-cli` is a pinned devDependency (`^23`), so `bun run env:pull` always uses the repo's CLI rather
than whatever `eas` is on your `PATH`; the same applies to every other `bun run eas …` invocation.
`eas env:pull` needs a logged-in session (`bun run eas login`) with access to the project; it
overwrites `.env.local` and stamps `# Environment: <name>` at the top so you can tell which one you
pulled. The three environments are safe to pull: nothing in them is `sensitive`, and secrets are never
written out.

### How CI uses them

- **EAS Workflows** (the native lane) read EAS environment variables directly — nothing to pull.
  Each job's environment is chosen as described above; `EXPO_TOKEN` is not needed inside EAS.
- **GitHub Actions** (the JS gate) runs against the schema defaults and `.env.example` today. Any job
  that needs real values (bundle export, Maestro web) runs `bun run env:pull` with `EXPO_TOKEN` in the
  environment; `eas-cli` honours it and skips the interactive login.
- GitHub repository secrets therefore hold exactly two things: `EXPO_TOKEN` (an EAS
  [robot / personal access token](https://docs.expo.dev/accounts/programmatic-access/)) and
  `SENTRY_AUTH_TOKEN` (for `bun run sentry:sourcemaps` after a web export, if that ever runs from
  GitHub rather than EAS). Everything else lives on EAS.

### Human setup checklist (owner)

The template creates only the two `EXPO_PUBLIC_*` variables above. Sentry is opt-in: until the DSN
exists, `src/lib/sentry.ts` is a no-op and source-map upload is skipped. When you are ready, run these
once from the project root (each `--environment` flag may be repeated to set one value in several
environments):

```sh
# Runtime DSN — one DSN per environment, or the same one three times.
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name EXPO_PUBLIC_SENTRY_DSN --value https://<key>@o<org>.ingest.sentry.io/<project> \
  --visibility plaintext --type string --non-interactive

# Build-time source-map upload (NOT EXPO_PUBLIC_; never reaches the bundle).
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_ORG --value <sentry-org-slug> --visibility plaintext --type string --non-interactive
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_PROJECT --value <sentry-project-slug> --visibility plaintext --type string --non-interactive
bun run eas env:set --scope project --environment development --environment preview --environment production \
  --name SENTRY_AUTH_TOKEN --value <token> --visibility secret --type string --non-interactive

# Confirm
bun run eas env:list --environment production --format long
```

Then add `SENTRY_AUTH_TOKEN` and `EXPO_TOKEN` as GitHub repository secrets. To point a real backend at
`staging` / `uat` / `production`, update `EXPO_PUBLIC_API_URL` per environment with the same
`env:set` command (it creates or updates in place).
