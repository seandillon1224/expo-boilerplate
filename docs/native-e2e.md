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

| EAS Workflows job     | Local script                              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fingerprint`         | `bun run fingerprint [--platform <p>]`    | Native fingerprint hash of the tree (`scripts/fingerprint.js`). The other scripts compute it themselves; run this to compare with the workflow's value.                                                                                                                                                                                                                                                                          |
| `get-build` / `build` | `bun run e2e:build [--platform <p>]`      | Finds a finished EAS build of the E2E profile (`e2e-ios-sim` / `e2e-android-apk` in `eas.json`) whose fingerprint matches, downloads it to `e2e/builds/<p>/base.(app\|apk)` and records it in `base.json`. On a miss it prints the `eas build` command and exits 2; pass `--build` to run that (paid) build and wait for it. `--build-id <id>` downloads a specific build.                                                       |
| `repack`              | `bun run e2e:repack [--platform <p>]`     | `@expo/repack-app`: runs `expo export:embed` for the current tree (Hermes bytecode, `APP_VARIANT=development` like the base build) and injects it into `base.(app\|apk)`, writing `e2e/builds/<p>/repacked.(app\|apk)`. No native rebuild.                                                                                                                                                                                       |
| `maestro`             | `bun run e2e:ios` / `bun run e2e:android` | Boots a simulator / emulator, installs `repacked.*` (or `base.*` if you skipped repack) and runs `maestro test .maestro --include-tags <p> -e MAESTRO_APP_ID=<bundle id \| package>` with JUnit output in `maestro-<p>/` (same layout as `bun run e2e:web`), Maestro's debug output in `maestro-<p>/debug/` and, after a failure, the simulator log / logcat in `maestro-<p>/device/` ([Failure artifacts](#failure-artifacts)). |

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

`E2E (native)` runs on every pull request into `main` (`on: pull_request`), when a PR is
labelled `e2e:ios` (`on: pull_request_labeled`), and by hand (`workflow_dispatch`). A `push` to
`main` trigger exists but is switched off (`if: false`) unless the project runs iOS in
`main-only` tier — see [Tiered mode](#tiered-mode); the staging OTA workflow (E5) covers `main`
otherwise. A new push to the same branch cancels the run in flight
(`concurrency.cancel_in_progress`).

```text
fingerprint ─┬─ get_build_ios ─────┬─ repack_ios      (hit:  reuse base build, inject this JS)
             │                     └─ build_ios       (miss: full EAS build, paid)
             │                          └──────────────── maestro_ios
             └─ get_build_android ─┬─ repack_android
                                   └─ build_android
                                        └──────────────── maestro_android
                                                               └── comment   (PR only, runs after everything)
```

| Job             | Type             | Inputs                                                                                                                                                                                                                                                                                                                  | Outputs used downstream                                                                                                                               |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fingerprint`   | `fingerprint`    | `environment: development`, `env.APP_VARIANT=development` (must equal the E2E build profiles, or the hash never matches)                                                                                                                                                                                                | `ios_fingerprint_hash`, `android_fingerprint_hash`                                                                                                    |
| `get_build_<p>` | `get-build`      | `platform`, `profile: e2e-ios-sim \| e2e-android-apk`, `simulator: true` (ios), `fingerprint_hash`, `wait_for_in_progress`; iOS only: the `IOS_MODE` `if:` ([Tiered mode](#tiered-mode)) — skipping it skips the whole iOS chain                                                                                        | `build_id` (empty on a miss)                                                                                                                          |
| `build_<p>`     | `build`          | `if: !get_build.build_id`; `platform`, `profile` (same E2E profile)                                                                                                                                                                                                                                                     | `build_id`                                                                                                                                            |
| `repack_<p>`    | `repack`         | `if: get_build.build_id`; `build_id` of the cached base build, `profile` (same E2E profile)                                                                                                                                                                                                                             | `build_id` (the repacked build)                                                                                                                       |
| `maestro_<p>`   | `maestro`        | `after: [repack, build]`; `build_id: repack \|\| build`, `flow_path: .maestro`, `include_tags: [<p>]`, `maestro_version: 2.10.0`, `shards: 2`, `retries: 2`, `retry_failed_only: true`, `record_screen: true`, `output_format: junit`, `env.MAESTRO_APP_ID`; `hooks.after_maestro_tests` collects + uploads device logs | Run artifacts: **Maestro Test Results** (recordings, JUnit, Maestro debug output) and **Device logs (<p>)** ([Failure artifacts](#failure-artifacts)) |
| `comment`       | `github-comment` | `after:` every job above; `if: github.event_name == 'pull_request'`; `params.payload` (custom markdown built from `after.<job>.status` / `.outputs`)                                                                                                                                                                    | `comment_url` (unused)                                                                                                                                |

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
report are in the **Maestro Test Results** artifact on the run page; an `after_maestro_tests` hook
adds the simulator log / logcat as **Device logs (<p>)** — see [Failure artifacts](#failure-artifacts)
for what each contains and how to pull it.

### PR comment

The last job, `comment` (`type: github-comment`), posts the run's outcome on the pull request
(PLAN.md decision 12: install links are shared by the `slack` and `github-comment` jobs). It is
wired with `after:` on every other job — `needs` would skip it as soon as anything failed, and
half of the jobs are skipped by design (`build_<p>` xor `repack_<p>`) — so it posts whatever
happened. `after.<job>.status` is `success | failure | skipped`, and the payload turns that into
the ✅ / ❌ / ⏭️ per platform; an iOS row reads `⏭️ skipped (ios_mode; …)` when the tier, not a
failure, skipped the lane. The job is skipped on `workflow_dispatch` and `push` (there is no PR
to post to; without the `if` it would fail the run).

What the comment contains, and where each value comes from:

| Line                             | Source                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maestro result                   | `after.maestro_<p>.status`, plus `successful_flows_count / total_flows_count` and `failed_flow_names_json` from the `maestro` job outputs.                                                                                                                                                                                                                          |
| Build                            | "cached base + repack" when `get_build_<p>` returned a `build_id`, else "fresh build". The link goes to the build page of the build Maestro actually ran (`repack_<p>.build_id \|\| build_<p>.build_id`), `https://expo.dev/accounts/<account>/projects/<slug>/builds/<id>`. No context exposes the Expo account or slug, so the prefix is spelled out in the YAML. |
| Fingerprint                      | `after.fingerprint.outputs.<p>_fingerprint_hash`, shortened to 12 characters.                                                                                                                                                                                                                                                                                       |
| Install / QR                     | The build page. The Android APK is an internal-distribution build, so its page hosts the install link and QR code; neither `build` nor `get-build` exposes an install URL output. The iOS build is a simulator `.app` — no QR, download it from the page or with `bun run e2e:build --platform ios --build-id <id>`.                                                |
| Recordings / JUnit / device logs | `${{ workflow.url }}` → the run page → **Maestro Test Results** and **Device logs (<p>)** artifacts; the triage walkthrough is [Failure artifacts](#failure-artifacts).                                                                                                                                                                                             |
| Reproduce locally                | The three-script loop from [Local reproduce](#local-reproduce).                                                                                                                                                                                                                                                                                                     |

The job's `payload` mode is fully custom markdown (it cannot be combined with `message` /
`build_ids`; the default mode renders EAS's own builds table instead). The job has no
update-in-place option, so every run adds a new comment rather than editing the previous one.
Posting needs the Expo GitHub App linked to the repository (prerequisite 1 below) — the comment
is written by the app, no GitHub token is involved. Expression gotcha for anyone editing the
payload: the evaluator resolves both branches of a `a ? b : c`, so string functions must be
guarded (`substring(x || '', 0, 8)`), otherwise a skipped job's missing output throws and the
comment job fails.

Example (JS-only PR on iOS, native change on Android, one Android flow failed):

```markdown
## E2E (native) · `0123456`

| Platform        | Maestro               | Build                                | Fingerprint    |
| --------------- | --------------------- | ------------------------------------ | -------------- |
| iOS (simulator) | ✅ passed (4/4 flows) | cached base + repack — [bbbbbbbb](…) | `abcdef012345` |
| Android (APK)   | ❌ failed (3/4 flows) | fresh build — [cccccccc](…)          | `fedcba987654` |

- Android failed flows: `["native/tabs"]`

- **Install**: the Android build page hosts the install link + QR code (internal distribution). The iOS build is a simulator `.app` with no QR code: download it from its page or `bun run e2e:build --platform ios --build-id <id>`.
- **Recordings / JUnit / device logs**: [workflow run](…) → artifacts → **Maestro Test Results** + **Device logs (ios | android)**. Triage: docs/native-e2e.md → Failure artifacts.
- **Reproduce locally**: `bun run e2e:build --platform <p> && bun run e2e:repack --platform <p> && bun run e2e:<p>` (docs/native-e2e.md).
```

Run it by hand: `bun run eas workflow:run .eas/workflows/e2e.yml` (or expo.dev → project →
Workflows → **E2E (native)** → Run); the only input is `ios_mode`, described next. Validate
after editing: `bun run eas workflow:validate .eas/workflows/e2e.yml` — EAS caps a workflow file
at 16 KiB, so long explanations belong on this page, not in the YAML.

### Tiered mode

Both platforms run on every PR by default (PLAN.md decision 14). iOS is the expensive lane — a
macOS worker for every repack and Maestro run, ~15 min of macOS build time on a fingerprint miss
— so a project can dial it down to one of three tiers. Android always runs: it is the cheap
signal and catches most JS regressions on its own.

| Event                              | `always` (default) | `main-only`       | `label`           |
| ---------------------------------- | ------------------ | ----------------- | ----------------- |
| PR opened / synchronize            | iOS ✅ Android ✅  | iOS ⏭️ Android ✅ | iOS ⏭️ Android ✅ |
| PR carries the `e2e:ios` label     | iOS ✅ Android ✅  | iOS ✅ Android ✅ | iOS ✅ Android ✅ |
| `e2e:ios` label added (`labeled`)  | iOS ✅ Android ✅  | iOS ✅ Android ✅ | iOS ✅ Android ✅ |
| Push to `main`                     | no run             | iOS ✅ Android ✅ | no run            |
| `workflow_dispatch` (input as set) | iOS ✅ Android ✅  | iOS ✅ Android ✅ | iOS ⏭️ Android ✅ |

"PR carries the label" means every later push to a labelled PR keeps running iOS; the `labeled`
row is the extra run EAS starts the moment the label lands (it cancels the run in flight for
that branch and re-runs both platforms). The label is an escape hatch in every tier: in
`main-only` it is how a reviewer asks for iOS on one risky PR without touching the file. In
`always` it is redundant.

**How it is wired.** EAS workflows have no top-level `env`, and `inputs.*` are empty on any run
that is not a `workflow_dispatch`, so the tier is a literal in the YAML — a repo-level constant
a PR author cannot override from the outside — with the dispatch input as the per-run override.
The three places, all marked `IOS_MODE n/3` in `.eas/workflows/e2e.yml`:

1. `get_build_ios.if` — `(inputs.ios_mode || 'always')`, twice: the `'always'` fallback _is_ the
   constant. The expression is `mode == always || (mode == main-only && event != pull_request) || PR has the e2e:ios label`. Skipping `get_build_ios` skips `build_ios` / `repack_ios` through
   `needs`, and `maestro_ios` through its empty-`build_id` guard; `comment` still posts.
2. `on.push.if` — `false` for `always` and `label`, `true` for `main-only` (the post-merge run
   is the only place iOS runs in that tier; in the other tiers it would repeat what the PR run
   just proved). Cost of `true`: one run per merge — repack + Maestro per platform on a JS-only
   merge, a full build per platform on a fingerprint change.
3. `on.workflow_dispatch.inputs.ios_mode.default` — the value the dispatch form pre-fills. Keep
   it equal to the constant so a plain "Run" behaves like a PR would.

To change the tier, edit all three (grep `IOS_MODE`) and re-run `workflow:validate`.

**Forcing a full run.** Add the `e2e:ios` label to the PR (create the label once in the repo:
`gh label create e2e:ios -c 5319e7 -d "Run the iOS Maestro lane on this PR"`), or run
`bun run eas workflow:run .eas/workflows/e2e.yml -F ios_mode=always` from the branch (a dispatch
run has no PR, so no comment is posted — read the run page instead). Dispatching with
`-F ios_mode=label` is the inverse: an Android-only run.

**Limits.** The label check is `contains(toJSON(github.event.pull_request.labels), '"e2e:ios"')`
— a substring match on the PR's label list, good enough unless a project adds another label
whose name contains `"e2e:ios"` verbatim. The `github` context lists `event_name` as
`pull_request | push | schedule | workflow_dispatch`; the `labeled` run is assumed to arrive as
`pull_request` (the expression and the `comment` guard both tolerate either), which is unverified
until the Expo GitHub App is linked and a labelled PR has run. No GitHub Actions helper or
`EXPO_TOKEN` is involved: EAS starts the labelled run from its own webhook.

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

## Failure artifacts

What a red `maestro_<p>` job leaves behind, where it lives, and the local twin of each file. On
the dashboard everything hangs off the run page: expo.dev → account → project **expo-boilerplate**
→ **Workflows** → the run (the PR comment links it) → **Artifacts** (one list per run) and, per
job, the step logs. The `maestro` job's only artifact-related inputs are `record_screen` and
`output_format` (checked against the live schema, `https://api.expo.dev/v2/workflows/schema`):
there is no failure-only recording switch and no debug-output or device-log input, which is why
device logs come from an `after_maestro_tests` hook that runs the same collector the local scripts
use.

| Artifact                                                                                               | Produced by                                                                                                                                   | Dashboard                                                                                                                                               | CLI                                                                                                         | Local equivalent                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Screen recording per flow                                                                              | `record_screen: true` (EAS records the simulator / emulator screen; `large` runner on Android for that reason)                                | run → Artifacts → **Maestro Test Results**                                                                                                              | — (no artifact download command in eas-cli 23; `eas/download_artifact` only works inside a later job)       | none: rerun with `bun run e2e:<p> --keep` and watch, or add `startRecording` to a flow                            |
| JUnit report (`report.xml`, one `<testcase>` per flow with the failing command in `<failure>`)         | `output_format: junit`                                                                                                                        | run → Artifacts → **Maestro Test Results** (Expo's docs also show it as a **Maestro Test Report (junit)** artifact — check both names on the first run) | —                                                                                                           | `maestro-<p>/report.xml`                                                                                          |
| Maestro debug output: failure screenshots, `maestro.log`, per-flow command/hierarchy JSON              | Maestro CLI (`$MAESTRO_TESTS_DIR` on the worker, `~/.maestro/tests/<timestamp>/` by default)                                                  | run → Artifacts → **Maestro Test Results**                                                                                                              | —                                                                                                           | `maestro-<p>/debug/` (`--debug-output … --flatten-debug-output`, same flags as `bun run e2e:web`)                 |
| Device logs: simulator unified log of the app's processes + crash reports (ios), `logcat -d` (android) | `hooks.after_maestro_tests` → `node scripts/e2e-device-logs.js` → `eas/upload_artifact` (`if: always()`, so it runs after a red Maestro step) | run → Artifacts → **Device logs (ios \| android)**                                                                                                      | —                                                                                                           | `maestro-<p>/device/` (`device.log` + `crashes/*.ips`, or `logcat.txt`; written only when Maestro exits non-zero) |
| Step logs (device boot, install, Maestro's per-flow output, the hook)                                  | EAS                                                                                                                                           | run → job → step                                                                                                                                        | `bun run eas workflow:logs <run or job id> --all-steps` (`--json` for machines)                             | the terminal output of `bun run e2e:<p>`                                                                          |
| Run / job summary (statuses, ids, the build that was tested)                                           | EAS                                                                                                                                           | run page                                                                                                                                                | `bun run eas workflow:runs`, `workflow:view <run id> --json`, `workflow:status <run id>`, `workflow:cancel` | —                                                                                                                 |

Sharding and retries: every shard and every retry attempt of a job writes into the same **Maestro
Test Results** artifact, so a flow can appear more than once. The flow `name:` (`native/<flow>`,
set in `.maestro/flows/<flow>.yaml`) is the stable key — search the artifact by it, and read the
last attempt's entry as the verdict (`retry_failed_only: true` re-runs only the failed flows).

Retention: Expo does not document a retention window for workflow artifacts; treat them as living
as long as the run does and download anything worth keeping (attach it to the issue). The web
lane's `maestro-web` GitHub Actions artifact (same layout: `report.xml`, `debug/`) is kept for
14 days (`retention-days` in `.github/workflows/ci.yml`).

### A flow failed on the PR — now what

1. **PR comment** → the `<p> failed flows` line names the flow(s); the **workflow run** link opens
   the run. No comment (GitHub App not linked yet, or a `workflow_dispatch` run)? `bun run eas
workflow:runs` lists recent runs with ids.
2. **Job logs**: run → **Maestro (<p>)** → the Maestro step. Maestro prints each flow as it runs
   and, for the failing one, the command and selector that failed, so this alone usually answers
   "which step". `bun run eas workflow:logs <run id> --all-steps > run.log` pulls the whole run.
3. **Recording**: Artifacts → **Maestro Test Results** → the failing flow's video. Scrub to the
   end: is the screen you expected there at all (wrong tab, permission dialog, blank screen after a
   JS crash), or is it the right screen with the wrong `testID`?
4. **JUnit**: `report.xml` → the `<failure>` message of that `<testcase>` is the exact assertion
   (command, selector, timeout). Useful when the recording is ambiguous.
5. **Maestro debug output** (same artifact): the failure screenshot, then `maestro.log` around the
   failing command, then the flow's command JSON for the view hierarchy Maestro saw — the place to
   confirm a `testID` is really missing rather than off-screen. Reading guide below.
6. **Device logs**: Artifacts → **Device logs (<p>)** → `device.log` / `logcat.txt`. Look for
   `ReactNativeJS` / `RCTLog` lines (JS exceptions, red-box text), `Fatal`, `SIGABRT`, and
   network failures; a crash on iOS also lands as `crashes/*.ips`.
7. **Reproduce**: `bun run e2e:build --platform <p> && bun run e2e:repack --platform <p> &&
bun run e2e:<p> --keep` writes the same set under `maestro-<p>/` and leaves the device up for
   `maestro studio` / a look around. Fix, rerun, push.
8. **Green on retry?** The job already re-runs failures (`retries: 2`); a flow that only passes on
   the second attempt is a flake candidate for T4.6's `quarantine` tag, not a fix.

### Reading Maestro's debug output

`--flatten-debug-output` (both `bun run e2e:*` and the workflow's Maestro run) puts every file of
the run flat in one directory, no per-run timestamp folder (names as of Maestro 2.10):

| File                                     | What it is                                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maestro.log`                            | The CLI's full log: driver setup, every command with its result, the failing command's stack. Grep for the flow name, then `Failed`.                                                    |
| `screenshot-❌-<timestamp>-(<flow>).png` | Taken automatically at the failing command (✅-prefixed ones come from explicit `takeScreenshot` steps). One glance usually explains the failure.                                       |
| `commands-(<flow>).json`                 | Every command of the flow with its status and timing; failed commands carry the error and the view hierarchy Maestro matched against — search it for the `testID` you expected to find. |
| `<flow>.mp4` / `<name>.png`              | Only if a flow uses `startRecording` / `takeScreenshot` with a relative path; EAS's `record_screen` videos are separate and not in this directory locally.                              |

Web parity: the JS gate's `Maestro web` job uploads `maestro-web/` (`report.xml` + `debug/`, the
same layout) as the `maestro-web` artifact on the GitHub Actions run (`docs/js-gate.md`); there is
no recording and no device log on web — the headless Chromium's console output is in `maestro.log`.

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
