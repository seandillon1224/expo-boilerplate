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
- Channels `staging` / `uat` / `production` exist on EAS (see
  [Update channels & runtime version](#update-channels--runtime-version)); the profile's `channel`
  is just a string baked into the build that tells the client which one to poll.
- `submit.production` is intentionally minimal (`android.track: internal`; iOS empty). Signing
  credentials, the App Store Connect API key and the Play service-account key all live on EAS (see
  [Credentials](#credentials)); the only value that will ever be added here is `ios.ascAppId`, once
  the App Store Connect record exists.
- `base.credentialsSource: remote` (the default, made explicit) means every profile signs with the
  credentials stored on EAS. There is no `credentials.json`, keystore or `.p12` in the repo and there
  never should be.
- The EAS project id (`885fa7d0-…`) lives once, in `app.config.ts` (`EAS_PROJECT_ID`), feeding both
  `extra.eas.projectId` and `updates.url`. `bun run init` (T7.1) rewrites it for a new app.

## Update channels & runtime version

[EAS Update](https://docs.expo.dev/eas-update/how-it-works/) delivers JS/asset updates to installed
builds. A build polls one **channel** (set by its `eas.json` profile); a channel points at a
**branch**; a branch is an ordered list of update groups. The three channels were created with
`bun run eas channel:create <name> --non-interactive`, each linked to a branch of the same name:

| Channel      | Branch       | Fed by                                                                                     | Builds that poll it  |
| ------------ | ------------ | ------------------------------------------------------------------------------------------ | -------------------- |
| `staging`    | `staging`    | Every merge to `main` (`deploy-staging` workflow, T5.1) via `eas update --channel staging` | `staging` profile    |
| `uat`        | `uat`        | Manual, approval-gated `eas update:republish --channel uat` of a staging group (T5.2)      | `uat` profile        |
| `production` | `production` | Manual, approval-gated `eas update:republish --channel production` of the UAT group (T5.2) | `production` profile |

PLAN.md decision 3: UAT and production are **republishes of the same update group**, never a fresh
`eas update` from a different commit, so what was tested is what ships. `development*` and `e2e-*`
builds have no channel and only ever run their embedded bundle. Publishing, promotion and rollback
commands live in the release ladder doc (T5.7, `docs/release-ladder.md`).

### Runtime version = native fingerprint

`app.config.ts` sets `runtimeVersion: { policy: 'fingerprint' }`, so the runtime version of every
build **and** every update is the [`@expo/fingerprint`](https://docs.expo.dev/versions/v57.0.0/sdk/fingerprint/)
hash of the project's native surface: the resolved Expo config, config plugins, autolinked native
modules under `node_modules`, native assets (icons, splash), `eas.json`, `.gitignore` and
`package.json` `scripts`. An update is only served to builds with an identical hash, which is what
makes it safe for `main` to auto-publish: a JS-only change reaches the installed staging build, a
native change produces a new hash that no existing build matches, and the `deploy-staging` workflow
notices (decision 13) and cuts new builds first.

Because this is a CNG project (no committed `ios/` / `android/`), `docs/**`, `.github/**`,
`.maestro/**`, `.claude/**`, `*.md` and everything under `src/` are simply not fingerprint sources —
verified by touching them and re-running the script below (hash unchanged) versus adding a plugin to
`app.config.ts` (both hashes changed). So no `.fingerprintignore` is needed today; if a future
native-adjacent path (for example a vendored `modules/` directory with test fixtures) needs excluding,
add a root `.fingerprintignore` with gitignore-style patterns, or `sourceSkips` /
`ignorePaths` in a `fingerprint.config.js`. Note that changing `package.json` `scripts` does bump the
hash by design (EAS Build lifecycle hooks such as `eas-build-pre-install` live there).

Inspecting:

```sh
bun run fingerprint                 # {"ios":"<sha1>","android":"<sha1>"} — the current runtime version
bun run fingerprint --platform ios  # one bare hash (for workflows); add --debug to list every source
bun run eas channel:list            # channels, their branches and the latest group on each
bun run eas branch:list
bun run eas update:list --channel staging   # what a staging build would receive right now
```

`@expo/fingerprint` is pinned as a devDependency to the exact version `expo@57` depends on so the
local hash matches what EAS Build and `eas update` compute; Renovate keeps the two in step.

## Environment variables

[EAS Environment Variables](https://docs.expo.dev/eas/environment-variables/) are the source of truth
(PLAN.md decision 9). EAS has three environments — `development`, `preview`, `production` — and we
have four `APP_VARIANT`s, so `preview` is shared by `staging` and `uat`; the build profile's `env`
tells them apart (see [Precedence](#precedence)). Every profile in `eas.json` sets `environment`
explicitly rather than relying on the CLI's inference (`store` → `production`, `developmentClient` →
`development`, else `preview`).

### Environment mapping

| EAS environment | Build profiles                                                           | `APP_VARIANT` (from profile `env`) | Update channel    | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------ |
| `development`   | `development`, `development-simulator`, `e2e-ios-sim`, `e2e-android-apk` | `development`                      | –                 | Dev clients and the release-mode Maestro shells. Also what `bun run env:pull` pulls. |
| `preview`       | `staging`, `uat`                                                         | `staging` / `uat`                  | `staging` / `uat` | Internal-distribution builds and the `main` → staging → UAT OTA promotions.          |
| `production`    | `production`                                                             | `production`                       | `production`      | Store builds and the production OTA promotion.                                       |

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

Signing / store credentials (details and exact commands in [Credentials](#credentials)):

- [ ] Apple Developer Program membership active for the team that owns `com.seandillon.expoboilerplate`.
- [ ] iOS ad hoc credentials for `development`, `staging` and `uat` (`bun run eas credentials -p ios`,
      after at least one device is registered — T3.5 / #32).
- [ ] iOS App Store credentials for `production`.
- [ ] App Store Connect API key stored on EAS (so `eas submit` and `release.yml` run with `EXPO_TOKEN`
      only).
- [ ] App Store Connect app record created; `ascAppId` added to `submit.production.ios` in a PR.
- [ ] Google Play app created, first AAB uploaded by hand, service account created and its JSON
      key uploaded to EAS.
- [x] Android keystores for all four application ids — generated by EAS in T3.4, nothing to do.

## Credentials

Everything that signs or submits a build is stored on EAS
([managed credentials](https://docs.expo.dev/app-signing/managed-credentials/)); `eas.json` sets
`credentialsSource: remote` on `base` so no profile can accidentally look for a local
`credentials.json`. Credentials are keyed by **application id** (bundle identifier / Android package),
and `app.config.ts` derives one per `APP_VARIANT`, so there are four of everything below. Nothing in
this section is ever committed: no keystores, no `.p12`, no `.p8`, no service-account JSON.

### Status by platform and variant

| Platform | Profile(s)                                                | Application id                           | Credential                                                   | Status                                                  |
| -------- | --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| Android  | `development`, `development-simulator`, `e2e-android-apk` | `com.seandillon.expoboilerplate.dev`     | Keystore (Build Credentials `Lc7t7TaxxH`)                    | Generated by EAS (T3.4)                                 |
| Android  | `staging`                                                 | `com.seandillon.expoboilerplate.staging` | Keystore (Build Credentials `ITp56ZwaQT`)                    | Generated by EAS (T3.4)                                 |
| Android  | `uat`                                                     | `com.seandillon.expoboilerplate.uat`     | Keystore (Build Credentials `PDfPnnFpvG`)                    | Generated by EAS (T3.4)                                 |
| Android  | `production`                                              | `com.seandillon.expoboilerplate`         | Upload keystore (Build Credentials `tyv8ZsDXQW`)             | Generated by EAS (T3.4); Play signing key = Google's    |
| Android  | `production` (submit)                                     | `com.seandillon.expoboilerplate`         | Google Play service-account JSON (EAS "Service Credentials") | Owner action required                                   |
| iOS      | `development`, `development-simulator` (sim: unsigned)    | `com.seandillon.expoboilerplate.dev`     | Distribution cert + **ad hoc** provisioning profile          | Owner action required (Apple login + registered device) |
| iOS      | `staging`                                                 | `com.seandillon.expoboilerplate.staging` | Distribution cert + **ad hoc** provisioning profile          | Owner action required                                   |
| iOS      | `uat`                                                     | `com.seandillon.expoboilerplate.uat`     | Distribution cert + **ad hoc** provisioning profile          | Owner action required                                   |
| iOS      | `production`                                              | `com.seandillon.expoboilerplate`         | Distribution cert + **App Store** provisioning profile       | Owner action required                                   |
| iOS      | `production` (submit)                                     | `com.seandillon.expoboilerplate`         | App Store Connect API key (`.p8`, stored on EAS)             | Owner action required                                   |
| iOS      | all                                                       | –                                        | Push notification key                                        | Not needed (no push in the boilerplate)                 |
| iOS      | `e2e-ios-sim`                                             | `com.seandillon.expoboilerplate.dev`     | – (simulator builds are unsigned)                            | Nothing to do                                           |

Notes:

- The `e2e-android-apk` and `development-simulator` profiles set `APP_VARIANT=development`, so they
  share the `.dev` keystore; `e2e-ios-sim` is a simulator build and needs no signing at all.
- Apple allows **one** distribution certificate per team to be managed by EAS; it is created the first
  time any iOS profile is configured and reused by all four bundle ids. Provisioning profiles are per
  bundle id _and_ per type: `development` / `staging` / `uat` get ad hoc profiles (PLAN.md decision 12:
  internal distribution, no `enterpriseProvisioning`), `production` gets an App Store profile.
- Android keystores were generated with
  `bun run eas credentials:configure-build --platform android --profile <profile>` (one confirm
  prompt, `Generate a new Android Keystore? → yes`; the command has no `--non-interactive` flag).
  Re-running it is a safe no-op: it prints `Using Keystore from configuration: Build Credentials …`.
- Play App Signing: the `production` keystore is only the **upload** key. Google generates and holds
  the app signing key when the app is created in Play Console with Play App Signing on (the default),
  so losing the upload key is recoverable through Play support; the other three ids are never uploaded
  to Play and their keystores are the whole story.

### iOS runbook (owner)

Needs the owner's Apple ID with 2FA — nobody else can do this, and it cannot be automated. Do it
once; afterwards anyone with access to the EAS project builds without Apple access.

1. **Apple Developer Program.** Confirm the team that will own `com.seandillon.expoboilerplate*` has an
   active [Apple Developer Program](https://developer.apple.com/programs/) membership (the paid one;
   ad hoc distribution is capped at 100 iPhones per team per year). Note the Team ID (Membership page).
2. **Register at least one device** (`docs/device-onboarding.md`): `bun run devices:add` — the ad hoc
   provisioning profiles below embed the device UDID allow-list, and EAS refuses to create an ad hoc
   profile with zero devices. Every later device addition needs a rebuild (or a re-sign from the
   `eas credentials` menu) to pick it up.
3. **Ad hoc credentials** for the three internal-distribution variants:

   ```sh
   bun run eas credentials -p ios
   #  › Select platform: iOS (already chosen by -p)
   #  › Which build profile do you want to configure? → staging
   #  › Do you want to log in to your Apple account? → yes   (Apple ID, password, 2FA code)
   #  › Select your Apple Team                          (if the Apple ID is on several)
   #  › "Build Credentials: Set up all the required credentials to build your app"
   #      → Generate a new Apple Distribution Certificate? → yes   (first time only; reused after)
   #      → Select devices for the ad hoc build           → pick all
   #      → Generate a new Apple Provisioning Profile?    → yes
   ```

   Repeat for `uat` and `development` (the dev client also installs via ad hoc). EAS registers the
   bundle identifier with Apple on the first run for each id; the certificate step is skipped after
   the first variant.

4. **App Store credentials** for `production`: same command, profile `production`; the only
   difference is that no device selection happens and EAS creates an App Store provisioning profile.
5. **App Store Connect API key** so `eas submit`, `release.yml` (T5.3) and the device-registration
   workflow (T3.5) can run with `EXPO_TOKEN` alone, no Apple login: in the same menu choose
   `App Store Connect: Manage your API Key` → `Generate a new App Store Connect API Key`. EAS creates
   the key in App Store Connect (role App Manager), downloads the `.p8` and stores it on EAS; nothing
   goes into `eas.json`. If a key must be created by hand instead (Users and Access → Integrations →
   App Store Connect API), pick `Upload an existing API Key` and provide the `.p8`, Key ID and Issuer
   ID.
6. **App Store Connect app record.** `eas submit -p ios` creates it on the first interactive run
   (Apple ID login) and prints the numeric app id. Put that in `eas.json` →
   `submit.production.ios.ascAppId` in a PR; from then on submissions are non-interactive
   (`--non-interactive` + `EXPO_TOKEN`) using the stored API key. `appleTeamId` is not needed once
   the API key is on EAS.
7. **Push key: skip.** `cli.promptToConfigurePushNotifications` is `false` in `eas.json`; nothing in
   the boilerplate sends push. If a product adds it later, `eas credentials -p ios` →
   `Push Notifications: Manage your Apple Push Notifications Key`.

What `eas build -p ios` prompts if you build before doing the above: exactly the same questions as
step 3 (Apple login → team → certificate → devices → profile), so a first build can double as the
setup — but do the credentials run first so CI never hits a prompt. With `--non-interactive` and no
stored credentials the build fails with `Credentials are not set up`; that is the signal that this
runbook was skipped.

### Google Play runbook (owner)

1. **Create the app** in [Play Console](https://play.google.com/console) with package
   `com.seandillon.expoboilerplate`, Play App Signing enabled (default). Only production is uploaded
   to Play; `.dev` / `.staging` / `.uat` APKs are side-loaded from the EAS install page.
2. **First upload by hand.** Google requires the first AAB of a new app to be uploaded through the
   console before the API may create releases: download the `production` build artefact from the EAS
   dashboard and upload it to the **internal testing** track once. Later releases go through
   `eas submit` / `release.yml`.
3. **Service account.** Follow
   [Creating a Google Service Account key](https://expo.fyi/creating-google-service-account): Google
   Cloud project → service account → JSON key; Play Console → Users and permissions → invite that
   service-account email with `Release to production, exclude devices, and use Play App Signing` (or
   at least release management on the internal track) for this app.
4. **Store the key on EAS** — not as an environment variable and not in the repo:

   ```sh
   bun run eas credentials -p android
   #  › Which build profile do you want to configure? → production
   #  › Google Service Account
   #      → Manage your Google Service Account Key for Play Store Submissions
   #      → Set up a Google Service Account Key for Play Store Submissions → path to the JSON
   ```

   `eas submit -p android` then finds it automatically; `submit.production.android` needs only
   `track: internal` (already set). `serviceAccountKeyPath` in `eas.json` is the local-file
   alternative and is deliberately unused so nothing sensitive is ever on disk in CI. Delete the
   downloaded JSON afterwards.

### Verify

```sh
# Android: per profile, must print "Using Keystore from configuration: Build Credentials …"
for p in development staging uat production; do
  bun run eas credentials:configure-build --platform android --profile $p
done

# Interactive listing (both platforms): pick a profile, the summary screen shows every credential
# for that application id — keystore / service account on Android, distribution certificate,
# provisioning profile (type + registered devices), API key on iOS.
bun run eas credentials -p android
bun run eas credentials -p ios

# Or read the same data on the web: https://expo.dev/accounts/seandillon1224/projects/expo-boilerplate/credentials

# eas.json still resolves (credentialsSource: remote on every profile)
bun run eas config --profile production --platform ios --non-interactive
```

Rotation and revocation live in the same `eas credentials` menus (`Remove`, `Update`), and every
change is logged on the project's credentials page. Because ad hoc profiles embed devices, after
registering a new tester rebuild the affected variant or run `eas credentials -p ios` → profile →
`Build Credentials` → regenerate the provisioning profile.
