# Native E2E (iOS / Android)

The native lane runs in EAS Workflows (PLAN.md decision 1): `fingerprint → get-build / build →
repack → maestro → update → approval → submit`. Base builds come from EAS Build keyed by
`@expo/fingerprint` (decision 2), and every PR reuses one by injecting a fresh JS bundle with
`@expo/repack-app` instead of rebuilding natively. This page covers the local twins of those
jobs; the workflow itself, the Maestro flow layout and the merge gate are filled in by E4 / E8.

## Local reproduce

When the `e2e` workflow goes red, run the same steps on a laptop. Each script is plain Node in
`scripts/`, takes `--help`, and fails fast with an install hint when a tool is missing. Nothing
here runs Metro against a dev server: the app under test is the release build EAS produced, with
the JS bundle from your working tree.

| EAS Workflows job     | Local script                              | What it does                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fingerprint`         | `bun run fingerprint [--platform <p>]`    | Native fingerprint hash of the tree (`scripts/fingerprint.js`). The other scripts compute it themselves; run this to compare with the workflow's value.                                                                                                                                                                                                                    |
| `get-build` / `build` | `bun run e2e:build [--platform <p>]`      | Finds a finished EAS build of the E2E profile (`e2e-ios-sim` / `e2e-android-apk` in `eas.json`) whose fingerprint matches, downloads it to `e2e/builds/<p>/base.(app\|apk)` and records it in `base.json`. On a miss it prints the `eas build` command and exits 2; pass `--build` to run that (paid) build and wait for it. `--build-id <id>` downloads a specific build. |
| `repack`              | `bun run e2e:repack [--platform <p>]`     | `@expo/repack-app`: runs `expo export:embed` for the current tree (Hermes bytecode, `APP_VARIANT=development` like the base build) and injects it into `base.(app\|apk)`, writing `e2e/builds/<p>/repacked.(app\|apk)`. No native rebuild.                                                                                                                                 |
| `maestro`             | `bun run e2e:ios` / `bun run e2e:android` | Boots a simulator / emulator, installs `repacked.*` (or `base.*` if you skipped repack) and runs `maestro test .maestro --include-tags <p> -e MAESTRO_APP_ID=<bundle id \| package>` with JUnit output in `maestro-<p>/` (same layout as `bun run e2e:web`).                                                                                                               |

`--platform` defaults to `ios`. `e2e/builds/`, `maestro-ios/` and `maestro-android/` are git-ignored.

Typical loop after a red `maestro` job:

```sh
bun run e2e:build --platform ios     # once per fingerprint; exits 2 with the eas build command on a miss
bun run e2e:repack --platform ios    # every time the JS changes
bun run e2e:ios                      # add --keep to leave the simulator running for a look
```

### Prerequisites

| Tool                                  | Needed by                     | Notes                                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EAS login (`bun run eas login`)       | `e2e:build`                   | Repo-pinned `eas-cli`; `EXPO_TOKEN` works too. `eas build:download` caches the artifact in its own directory; the script copies it under `e2e/builds/`.                                                                                                         |
| Xcode + command line tools            | `e2e:repack` (ios), `e2e:ios` | `xcrun simctl` picks an already-booted iPhone, else the newest available one (`--device <udid\|name>` to override). The simulator `.app` is unsigned: repack strips the old signature and nothing needs re-signing.                                             |
| JDK (`java`) + Android build-tools    | `e2e:repack` (android)        | `@expo/repack-app` ships `apktool.jar` and a debug keystore; it needs `java` on PATH and `aapt2` / `zipalign` / `apksigner` under `$ANDROID_SDK_ROOT/build-tools` (falls back to `$ANDROID_HOME`). The APK is debug-signed (`android`), which emulators accept. |
| `adb` (+ `emulator` or a running AVD) | `e2e:android`                 | Uses the first online `adb` device; otherwise starts the first AVD from `emulator -list-avds` and waits for `sys.boot_completed`. `--device <serial>` to pin one.                                                                                               |
| Maestro CLI                           | `e2e:ios`, `e2e:android`      | `curl -Ls "https://get.maestro.mobile.dev" \| bash`; resolved from PATH or `~/.maestro/bin`. CI pins 2.10.0 — use the same locally, 2.3.0 has known selector bugs (see `.maestro/subflows/select-tab.yaml`).                                                    |

Differences from the workflow, on purpose: the workflow's `repack` job signs with the project's
EAS credentials so the artifact can also ship as an internal build; locally the simulator `.app`
stays unsigned and the APK is debug-signed. The workflow's `maestro` job also runs on a fresh EAS
device; locally the app is installed over whatever is already on the simulator (`simctl install`
/ `adb install -r` replace it in place).

## Workflow (`.eas/workflows/e2e.yml`)

`E2E (native)` runs on every pull request into `main` (`on: pull_request`) and by hand
(`workflow_dispatch`). Pushes to `main` are not a trigger: the staging OTA workflow (E5) covers
those. A new push to the PR branch cancels the run in flight (`concurrency.cancel_in_progress`).

```text
fingerprint ─┬─ get_build_ios ─────┬─ repack_ios      (hit:  reuse base build, inject this JS)
             │                     └─ build_ios       (miss: full EAS build, paid)
             │                          └──────────────── maestro_ios
             └─ get_build_android ─┬─ repack_android
                                   └─ build_android
                                        └──────────────── maestro_android
```

| Job             | Type          | Inputs                                                                                                                                                                                                                                                      | Outputs used downstream                            |
| --------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `fingerprint`   | `fingerprint` | `environment: development`, `env.APP_VARIANT=development` (must equal the E2E build profiles, or the hash never matches)                                                                                                                                    | `ios_fingerprint_hash`, `android_fingerprint_hash` |
| `get_build_<p>` | `get-build`   | `platform`, `profile: e2e-ios-sim \| e2e-android-apk`, `simulator: true` (ios), `fingerprint_hash`, `wait_for_in_progress`                                                                                                                                  | `build_id` (empty on a miss)                       |
| `build_<p>`     | `build`       | `if: !get_build.build_id`; `platform`, `profile` (same E2E profile)                                                                                                                                                                                         | `build_id`                                         |
| `repack_<p>`    | `repack`      | `if: get_build.build_id`; `build_id` of the cached base build, `profile` (same E2E profile)                                                                                                                                                                 | `build_id` (the repacked build)                    |
| `maestro_<p>`   | `maestro`     | `after: [repack, build]`; `build_id: repack \|\| build`, `flow_path: .maestro`, `include_tags: [<p>]`, `maestro_version: 2.10.0`, `shards: 2`, `retries: 2`, `retry_failed_only: true`, `record_screen: true`, `output_format: junit`, `env.MAESTRO_APP_ID` | JUnit report + recordings in the run's artifacts   |

How the cache works: `get-build` asks EAS for a finished build of the E2E profile whose
fingerprint equals this commit's. JS-only PRs hit (fingerprint unchanged since the last native
build), so the run is `repack` + `maestro` only — a few minutes and no build minutes. A PR that
touches the native surface (a config plugin, a native dependency, `app.config.ts` identifiers)
misses; `build_<p>` then produces a fresh base for that fingerprint, which the same PR's later
pushes and every later PR with that fingerprint reuse. A fresh build already embeds the commit's
JS, so it is not repacked; `maestro` takes whichever `build_id` exists (Expo's documented
fingerprint + repack idiom). Two PRs racing on the same new fingerprint do not both build:
`wait_for_in_progress` makes the second wait for the first's build.

Maestro on EAS: `flow_path: .maestro` is the workspace directory, so `config.yaml` is read and
`include_tags` selects the native entries exactly like `bun run e2e:<p>`. The app id reaches the
flows as `MAESTRO_APP_ID` — Maestro exposes `MAESTRO_*` shell variables to flows, which is the
only way a pre-packaged job can pass a value; the local scripts set the same name with `-e`. The
value is spelled out in the workflow because the job cannot run `expo config`; `bun run init`
(T7.1) rewrites it with the identifiers in `app.config.ts`. Sharding (`shards: 2`, 4 flows) is
experimental on EAS — set it to `1` first if a run misbehaves. `retries: 2` re-runs only the
failed flows; T4.6 turns that into a tracked flake budget. Recordings, screenshots and the JUnit
report are in the **Maestro Test Results** artifact on the run page (T4.4 documents triage).

Run it by hand: `bun run eas workflow:run .eas/workflows/e2e.yml` (or expo.dev → project →
Workflows → **E2E (native)** → Run). Validate after editing:
`bun run eas workflow:validate .eas/workflows/e2e.yml`. The `tier` dispatch input is a
placeholder for T4.5 and is not read yet.

### Human prerequisites (once)

1. **Link the Expo GitHub App** so PRs trigger the workflow and the run reports back as a check:
   expo.dev → account → project **expo-boilerplate** → **GitHub** settings → install the app and
   link `seandillon1224/expo-boilerplate`. The Expo user needs a linked GitHub account. No
   `EXPO_TOKEN` is involved — EAS triggers itself from the webhook; GitHub Actions never calls
   EAS.
2. **Budget for the first run**: with no stored E2E build for the current fingerprint, both
   `build_ios` and `build_android` run (two paid builds, ~15 min each). Every JS-only PR after
   that repacks instead.
3. **Make the check required**: after the first PR run, read the exact check context from
   `gh pr checks <n>`, add that string verbatim to `REQUIRED_CHECKS` in `scripts/repo-settings.js`
   and run `bun run repo:settings:apply` (see `docs/js-gate.md` → How EAS checks appear on the
   PR). Until then the EAS check is informational.

## Maestro flows and tags

`.maestro/` is a Maestro workspace: always point the CLI at the directory (`maestro test
.maestro …`) so `config.yaml` is read — Maestro only loads it from the directory it is given, and
its flow discovery is otherwise non-recursive. The header comment in `config.yaml` is the
canonical description; in short:

| Path                                  | Role                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.maestro/config.yaml`                | Workspace config: `flows: ['flows/*', 'flows/web/*']`, env contract (`MAESTRO_APP_ID`, `APP_URL`), tag and selector rules.                    |
| `.maestro/flows/<name>.yaml`          | Native entry: `appId: ${MAESTRO_APP_ID}`, `tags: [ios, android]`, then `runFlow` launch + steps. Discovered by `--include-tags ios\|android`. |
| `.maestro/flows/web/<name>.yaml`      | Web entry: `url: ${APP_URL}`, `tags: [web]`, same steps. Discovered by `--include-tags web` (CI `maestro-web`, `bun run e2e:web`).            |
| `.maestro/subflows/launch.yaml`       | Native `launchApp` (`clearState`, all permissions allowed).                                                                                   |
| `.maestro/subflows/launch-web.yaml`   | Web `launchApp` (opens `APP_URL`).                                                                                                            |
| `.maestro/subflows/select-tab.yaml`   | Tab-bar tap with a `when: platform` branch per OS — the only non-testID selector, see below.                                                  |
| `.maestro/subflows/steps/<name>.yaml` | The shared steps (`smoke`, `tabs`, `fetch`, `updates`), written once and run by both entries.                                                 |

Two entry files per flow are unavoidable: Maestro picks the Chromium driver from a `url:` header
alone (`url` beats `appId`; `--platform` does not override it), so one file cannot serve both
lanes. Subflows are never discovered as flows (the globs only match `flows/*` and `flows/web/*`)
but Maestro 2.x still requires a config section in every file, hence the inert `appId: ${MAESTRO_APP_ID}`
header on each subflow.

Tags: `web`, `ios`, `android` select entries; `quarantine` is reserved for T4.6 (flaky flows
excluded from the gate with `--exclude-tags quarantine`).

Selectors are testIDs only (`id:` = accessibilityIdentifier on iOS, resource-id on Android, DOM
id on web). The tab bar is the one exception, isolated in `select-tab.yaml`: `NativeTabs.Trigger`
gets `testID="tab-<route>"` in `src/app/(tabs)/_layout.tsx`, which is the item's accessibility
identifier on iOS (`id: tab-settings`), but only a view tag on Android (Maestro cannot read it, so
the visible label is matched via `TAB_LABEL`) and absent on web (Radix generates
`radix-<uid>-trigger-(settings)-<nanoid>`, matched by regex).

### Adding a flow

1. Write the steps once in `.maestro/subflows/steps/<name>.yaml` with an `appId: ${MAESTRO_APP_ID}`
   header. Select by `id:` only; for the tab bar use
   `runFlow: { file: ../select-tab.yaml, env: { TAB: settings, TAB_LABEL: Settings } }`.
2. Add the native entry `.maestro/flows/<name>.yaml`:

   ```yaml
   name: native/<name>
   appId: ${MAESTRO_APP_ID}
   tags: [ios, android]
   ---
   - runFlow: ../subflows/launch.yaml
   - runFlow: ../subflows/steps/<name>.yaml
   ```

3. Add the web entry `.maestro/flows/web/<name>.yaml` with `name: web/<name>`, `url: ${APP_URL}`,
   `tags: [web]` and `../../subflows/launch-web.yaml` + `../../subflows/steps/<name>.yaml`.
4. Verify web locally (`bun run export:web && bun run serve:web &` then `bun run e2e:web`) and
   native with the loop above. A step that must differ per platform goes in its own subflow with
   `when: { platform: iOS | Android | Web }` blocks, like `select-tab.yaml`.

## Update → approval → submit

_Placeholder — E5/E6: OTA to `staging` on merge, manual approval-gated promotion to UAT / production._
