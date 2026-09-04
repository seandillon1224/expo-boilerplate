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
| `maestro`             | `bun run e2e:ios` / `bun run e2e:android` | Boots a simulator / emulator, installs `repacked.*` (or `base.*` if you skipped repack) and runs `maestro test .maestro --include-tags <p> -e APP_ID=<bundle id \| package>` with JUnit output in `maestro-<p>/` (same layout as `bun run e2e:web`).                                                                                                                       |

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

_Placeholder — T4.2 wires `fingerprint → get-build → build → repack → maestro` and this section
documents job names, triggers and how the check shows on the PR._

## Maestro flows and tags

`.maestro/` is a Maestro workspace: always point the CLI at the directory (`maestro test
.maestro …`) so `config.yaml` is read — Maestro only loads it from the directory it is given, and
its flow discovery is otherwise non-recursive. The header comment in `config.yaml` is the
canonical description; in short:

| Path                                  | Role                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `.maestro/config.yaml`                | Workspace config: `flows: ['flows/*', 'flows/web/*']`, env contract (`APP_ID`, `APP_URL`), tag and selector rules.                    |
| `.maestro/flows/<name>.yaml`          | Native entry: `appId: ${APP_ID}`, `tags: [ios, android]`, then `runFlow` launch + steps. Discovered by `--include-tags ios\|android`. |
| `.maestro/flows/web/<name>.yaml`      | Web entry: `url: ${APP_URL}`, `tags: [web]`, same steps. Discovered by `--include-tags web` (CI `maestro-web`, `bun run e2e:web`).    |
| `.maestro/subflows/launch.yaml`       | Native `launchApp` (`clearState`, all permissions allowed).                                                                           |
| `.maestro/subflows/launch-web.yaml`   | Web `launchApp` (opens `APP_URL`).                                                                                                    |
| `.maestro/subflows/select-tab.yaml`   | Tab-bar tap with a `when: platform` branch per OS — the only non-testID selector, see below.                                          |
| `.maestro/subflows/steps/<name>.yaml` | The shared steps (`smoke`, `tabs`, `fetch`, `updates`), written once and run by both entries.                                         |

Two entry files per flow are unavoidable: Maestro picks the Chromium driver from a `url:` header
alone (`url` beats `appId`; `--platform` does not override it), so one file cannot serve both
lanes. Subflows are never discovered as flows (the globs only match `flows/*` and `flows/web/*`)
but Maestro 2.x still requires a config section in every file, hence the inert `appId: ${APP_ID}`
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

1. Write the steps once in `.maestro/subflows/steps/<name>.yaml` with an `appId: ${APP_ID}`
   header. Select by `id:` only; for the tab bar use
   `runFlow: { file: ../select-tab.yaml, env: { TAB: settings, TAB_LABEL: Settings } }`.
2. Add the native entry `.maestro/flows/<name>.yaml`:

   ```yaml
   name: native/<name>
   appId: ${APP_ID}
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
