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
| `maestro`             | `bun run e2e:ios` / `bun run e2e:android` | Boots a simulator / emulator, installs `repacked.*` (or `base.*` if you skipped repack) and runs `maestro test .maestro/flows --include-tags <p> -e APP_ID=<bundle id \| package>` with JUnit output in `maestro-<p>/` (same layout as `bun run e2e:web`). Until a flow is tagged `ios` / `android` it prints a notice and exits 0.                                        |

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
| Maestro CLI                           | `e2e:ios`, `e2e:android`      | `curl -Ls "https://get.maestro.mobile.dev" \| bash`; resolved from PATH or `~/.maestro/bin`. CI pins 2.10.0 — use the same locally, 2.3.0 has known selector bugs (see `.maestro/flows/tabs.yaml`).                                                             |

Differences from the workflow, on purpose: the workflow's `repack` job signs with the project's
EAS credentials so the artifact can also ship as an internal build; locally the simulator `.app`
stays unsigned and the APK is debug-signed. The workflow's `maestro` job also runs on a fresh EAS
device; locally the app is installed over whatever is already on the simulator (`simctl install`
/ `adb install -r` replace it in place).

## Workflow (`.eas/workflows/e2e.yml`)

_Placeholder — T4.2 wires `fingerprint → get-build → build → repack → maestro` and this section
documents job names, triggers and how the check shows on the PR._

## Maestro flows and tags

_Placeholder — T4.1 tags the native flows (`ios`, `android`) and adds the launch subflow that reads
`APP_ID`; `.maestro/config.yaml` documents the env contract today._

## Update → approval → submit

_Placeholder — E5/E6: OTA to `staging` on merge, manual approval-gated promotion to UAT / production._
