# Performance: which layer answers what

PLAN.md decision 7 picks the tools: Rozenite (dev-time DevTools), Expo Atlas (bundle composition),
Reassure (render-time regression tests), per-platform bundle budgets, and EAS Observe for production
telemetry, with Sentry limited to errors. Each has its own how-to page; this page is the map: what
question each layer answers, where to look, when it runs, and what a failure means.

## Question → layer

| Question                                                         | Layer                        | Where to look                                                                                                           | When it runs                                                            | What fails                                                                                       |
| ---------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Why is this screen slow / re-rendering in dev?                   | Rozenite performance monitor | React Native DevTools → _Performance Monitor_ panel ([rozenite.md](rozenite.md))                                        | Dev client + dev server (`bun run ios` / `android`)                     | Nothing; it is a viewer                                                                          |
| Why is this query refetching, or this request slow?              | Rozenite Query / Network     | DevTools → _TanStack Query_ / _Network_ panels ([rozenite.md](rozenite.md))                                             | Same                                                                    | Nothing; it is a viewer                                                                          |
| What made the bundle bigger, and which import caused it?         | Expo Atlas                   | `bun run atlas:export` → treemap, _Imported by modules_ ([atlas.md](atlas.md))                                          | Local, on demand                                                        | Nothing; it is the diagnosis                                                                     |
| Is the JS bundle over budget?                                    | Bundle budget                | CI `Bundle budget (web \| ios \| android)`; `bundle-budget.json`, `dist-<platform>/bundle-sizes.json`                   | Every PR and push to `main` (required check)                            | gzip size of the `expo export` bundle above its limit → exit 1                                   |
| Did this PR regress render time?                                 | Reassure                     | CI `Perf (Reassure)` step summary / `reassure` artifact; locally `.reassure/output.md` ([perf-tests.md](perf-tests.md)) | Every PR (informational, not required)                                  | A statistically significant slowdown in any `*.perf-test.tsx` (`perf:gate`)                      |
| Are real users seeing slow startup / navigation after a release? | EAS Observe                  | `bun run observe:check`, `bun run eas observe:*`, expo.dev → Observe ([observe.md](observe.md))                         | Continuously on staging / UAT / production installs; check after a soak | `observe:check`: a (version, platform) row over `observe-budget.json` with ≥ `minSamples` events |
| Is there a crash or JS error in the field?                       | Sentry                       | Sentry issue stream (tags `update_id`, `channel`, `runtime_version`); `src/lib/sentry.ts`                               | Release builds with `EXPO_PUBLIC_SENTRY_DSN` set                        | Nothing automatically; errors only, no perf tracing (see below)                                  |
| Does the app still work end to end on a release build?           | Maestro E2E                  | `E2E (native)` EAS workflow, CI `Maestro web` ([native-e2e.md](native-e2e.md))                                          | Every PR                                                                | A flow assertion; not a perf signal                                                              |
| Did this PR change release-build CPU / RAM / FPS on Android?     | Flashlight                   | `E2E (native)` run → artifact **Flashlight (android)** (`report/` HTML + `results.json`); locally `flashlight/`         | Opt-in (`FLASHLIGHT` constant or `-F flashlight=enabled` dispatch)      | Nothing; informational, no budget yet ([ADR-0007](adr/0007-flashlight-android-perf-hook.md))     |

## The layers

### Rozenite (dev-time DevTools) — [rozenite.md](rozenite.md)

Plugin host for React Native DevTools. `bun run ios` / `android` / `start` set `WITH_ROZENITE=true`;
press `j` in the Expo CLI terminal to open DevTools and the panels appear in the sidebar. Three
panels are wired: TanStack Query (cache state and actions), Network (fetch / XHR / WebSocket / SSE
timing and bodies) and Performance Monitor (startup phases plus `react-native-performance` marks).
Dev client only, never in a release bundle, no CI job. Use it to reproduce and explain a slow
interaction before touching code.

### Expo Atlas (bundle composition) — [atlas.md](atlas.md)

Expo CLI's bundle inspector, gated on `EXPO_ATLAS=true`. `bun run atlas` attaches to the dev server
(`http://localhost:8081/_expo/atlas`, right for "who imports this"); `bun run atlas:export` (or
`atlas:export:web|ios|android`) inspects a release export, which is the mode to trust for sizes.
Local and on demand; no CI or EAS job ever sets `EXPO_ATLAS`. The budget says a bundle is too big,
Atlas says why.

### Bundle budgets (size gate) — `bundle-budget.json`

`bun run export:<platform>` then `bun run budget:<platform>` (`bun run budget` runs all three after
the exports) measures the gzip size of the `expo export` JS / CSS bundles (Hermes `.hbc` on native)
with `scripts/bundle-budget.js` and exits 1 above the limit in `bundle-budget.json`. CI runs it as
`Bundle budget (web)`, `(ios)`, `(android)` on every PR and push to `main`; all three are required
checks ([js-gate.md](js-gate.md)) and upload `bundle-sizes-<platform>` for trend tracking. Raise a
limit only with an Atlas finding as the justification in the PR.

### Reassure (render-time regression tests) — [perf-tests.md](perf-tests.md)

`src/__perf__/*.perf-test.tsx` measure render duration and count under Jest with `measureRenders`
/ `measureFunction`. Locally: `bun run perf:baseline` on the base commit, `bun run perf` on your
branch, `bun run perf:gate` (`scripts/reassure-gate.js`) for the pass / fail rule; `bun run
perf:check` tells you how noisy the machine is. CI job `Perf (Reassure)` measures the PR base and
head on the same runner and gates on any statistically significant slowdown; it is PR-only and
informational (not in the required-check set), so treat red as a review signal. Add a perf test for
every screen or hook whose cost you have just fixed.

### EAS Observe (production telemetry) — [observe.md](observe.md)

`expo-observe`, configured once in `src/lib/observe.ts`, reports cold / warm launch, bundle load,
TTR, per-route navigation timing and TTI from real installs of release builds (`dispatchInDebug:
false`; 100 % of staging / UAT installs, 25 % of production). TTI is the app-defined metric: every
data-loading screen calls `markInteractive` once its content is usable. Read it with `bun run eas
observe:metrics-summary` / `observe:metrics` / `observe:routes` / `observe:session`, or hold a
release to `observe-budget.json` with `bun run observe:check` (informational `observe` job in the
`Deploy staging` workflow, on demand or cron via the `Observe check` workflow, `--strict` for gate
mode). This is the only layer that sees production.

### Sentry (errors only) — `src/lib/sentry.ts`

No-op without `EXPO_PUBLIC_SENTRY_DSN`; disabled in `__DEV__`. Every event is tagged with the
OTA update id, channel and runtime version so a crash can be pinned to an update group. Source maps
upload with `bun run sentry:sourcemaps` after an export or `eas update`. `tracesSampleRate` is 0 and
auto performance / app-start / frames tracking are off: Sentry answers "what threw", never "what is
slow".

### Flashlight (release-build CPU / RAM / FPS on Android) — `scripts/flashlight.js`

[Flashlight](https://docs.flashlight.dev) (by BAM) profiles the app process on an Android device
while a command runs, N times, and scores CPU, RAM and frame rate into a static HTML report. It is
the only layer that measures a **release build on a device before release**: Reassure measures
render cost under Jest, Observe measures real installs after the fact. It runs as an
`after_maestro_tests` hook of the `maestro_android` job in `.eas/workflows/e2e.yml`, where the
emulator is still up with the e2e build installed, and profiles one flow —
`.maestro/flows/fetch.yaml` (launch with cleared state → fetch screen → data on screen) — for 5
iterations of 10 s (`bun run perf:flashlight --platform android --no-fail --out flashlight`).

- **Enable it.** Off by default behind the `FLASHLIGHT` repo constant (`disabled`), the
  [`IOS_MODE` idiom](native-e2e.md#tiered-mode): dispatch one run with
  `bun run eas workflow:run .eas/workflows/e2e.yml -F flashlight=enabled`, or flip the input's
  `default` in the file to run on every PR. The step never fails the job: a disabled constant, a
  missing `adb` / `maestro` / `flashlight` / device or a failed run is a notice in the step log and
  a `README.txt` in the artifact.
- **Read it.** Run page → Artifacts → **Flashlight (android)**: `report/` (open `index.html`;
  score, per-iteration CPU / RAM / FPS charts, thread breakdown), `results.json` (the raw
  measures) and `README.txt` (iterations, average time / CPU / RAM / FPS). The step log prints
  the same summary.
- **Compare two runs.** Download both `results.json`, then
  `flashlight report base/results.json pr/results.json -o compare` renders them side by side.
- **Locally.** `bun run e2e:android --keep` (emulator stays up with the build), then
  `bun run perf:flashlight --platform android [--iterations 5] [--flow <path>] [--device <serial>]`;
  `--install` fetches Flashlight (`curl https://get.flashlight.dev | bash`, CI does this by
  itself). Exits 1 on any problem without `--no-fail`.
- **Noise.** Emulator numbers are relative, not device numbers: compare only run-to-run on the
  same worker class (`linux-large-nested-virtualization`) or the same laptop, and treat a
  difference smaller than the run-to-run spread as nothing. That variance is why there is no
  budget yet: once a few runs show it, add `flashlight-budget.json` and a gate the way
  `observe-budget.json` / `observe:check` do it.
- **Maintenance.** Flashlight's npm packages were last published in mid-2024 (v0.18); the repo
  still receives commits. Opt-in and informational until that settles
  ([ADR-0007](adr/0007-flashlight-android-perf-hook.md)).

## Lifecycle

| Stage           | What runs                                                                                                                                                                                   | Owner                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Local dev       | Rozenite panels while you work; `bun run atlas` / `atlas:export` when a dependency or bundle question comes up; `bun run perf:baseline` + `perf` before pushing a change you expect to cost | The engineer                                                    |
| PR gate         | `Bundle budget (web \| ios \| android)` (required), `Perf (Reassure)` (informational), `Maestro web` + `E2E (native)` for behaviour, Flashlight inside `E2E (native)` when enabled          | `.github/workflows/ci.yml`, `.eas/workflows/e2e.yml`            |
| Merge to `main` | `Deploy staging` publishes the OTA group and prints the previous groups' Observe TTI state (`observe` job, never fails)                                                                     | `.eas/workflows/deploy-staging.yml`                             |
| Post-deploy     | Staging soak → `bun run observe:check --days <soak> --version <v>` (or the `Observe check` workflow) before approving `Promote`; Sentry issue stream for errors                             | The promotion approver ([release-ladder.md](release-ladder.md)) |

Nothing in the PR gate needs an EAS account or a device: budgets and Reassure run on plain GitHub
runners from a JS-only export.

## What is deliberately not here

- **Sentry performance tracing.** Off (`tracesSampleRate: 0`, no auto / app-start / frames
  tracking). Observe already measures startup and navigation on real installs with the Expo Router
  integration, and one source of truth for "is production slow" is the point; a second tracer
  would double the event volume and split the answer. Turn it on only if Observe is dropped.
- **A Flashlight gate.** The hook is informational on purpose: emulator variance is unknown until
  a few runs exist. Do not add a threshold before a baseline shows the spread (see
  [Flashlight](#flashlight-release-build-cpu-ram-fps-on-android-—-scripts-flashlight-js)).
- **Flashlight on iOS.** Flashlight has no iOS profiler; nothing to wire.
- **Firebase Performance Monitoring** (or any other prod perf SDK). Same reason as Sentry tracing:
  Observe owns production telemetry, and adding a second native module moves the fingerprint and
  cold launch for every install.
- **Bundle-size comments on PRs.** The budget jobs write to the step summary and upload
  `bundle-sizes-<platform>`; no bot comment, so CI permissions stay read-only.

## Triage flow: "the app feels slow"

1. **Confirm it in Observe.** `bun run observe:check --days 7`, then
   `bun run eas observe:metrics tti --sort slowest --days 7` and `observe:session <id>` for the
   worst session: `slowFrames` / `totalDelay` mean main-thread work, `frozenFrames` a blocking call,
   a slow startup request a fetch to defer. Compare `cold_launch` and `bundle_load` across versions
   to split native from JS time; a jump right after a store release with no JS change is native.
   Use `observe:routes` when the complaint is about one screen rather than startup.
2. **Reproduce with Rozenite.** Open the screen in a dev client with DevTools: the Performance
   Monitor shows startup phases and custom marks, the Network panel shows request waterfalls, and
   the TanStack Query panel shows refetch storms or missing cache hits.
3. **Check size.** If the regression coincides with a dependency change, `bun run atlas:export`
   and walk _Imported by modules_ from the biggest new rectangle; `bun run budget` tells you whether
   it is over the limit, Atlas tells you what to remove.
4. **Lock the fix.** Add or extend a `src/__perf__/*.perf-test.tsx` that exercises the slow path
   (`bun run perf:baseline` on `main`, `bun run perf` on the fix, keep the significant speed-up in
   `.reassure/output.md` as evidence in the PR). If the cause was bundle size, tighten
   `bundle-budget.json` to the new measurement plus headroom.
5. **Verify after release.** Re-run `observe:check --version <new version>` after the staging soak
   and compare against the row that started the investigation.
