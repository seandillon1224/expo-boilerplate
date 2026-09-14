# ADR-0007: Flashlight as an opt-in hook of the Android E2E job, not a lane

- **Status:** Accepted
- **Date:** 2026-09-13
- **Issue:** #63 (D4 Flashlight in the Android E2E lane; decided with the owner 2026-09-13)

## Context

PLAN.md decision 7 lists Flashlight as the "later epic" of the performance story and D4 places it
"in the Android E2E lane". [Flashlight](https://docs.flashlight.dev) (BAM) profiles an Android app
process over `adb` while a command runs, repeats it N times, and scores CPU, RAM and FPS into a
static HTML report; it has no iOS profiler. It is the only layer here that measures a **release
build on a device before release** — Reassure ([perf-tests.md](../perf-tests.md)) measures render
cost under Jest, EAS Observe ([observe.md](../observe.md)) measures real installs after the fact,
and the bundle budget measures bytes. Two facts shape the decision: the `maestro_android` job of
`e2e.yml` already leaves an emulator running with the e2e build installed (that is how device logs
and the a11y audit, ADR-0005, run from its `after_maestro_tests` hook), and Flashlight's npm
packages were last published in mid-2024 (v0.18) although the repository still receives commits —
a maintenance risk. Emulator numbers on a shared worker are also noisy, and the variance is
unknown until runs exist.

## Decision

Flashlight is **an `after_maestro_tests` hook step of the existing `maestro_android` job** in
`.eas/workflows/e2e.yml`, after the device-log and a11y steps: `scripts/flashlight.js`
(`bun run perf:flashlight`, Node built-ins only, shares the device / app-id preflight with the
a11y audit) installs Flashlight on the worker, runs `flashlight test` on **one flow** —
`.maestro/flows/fetch.yaml`, whose `clearState` launch gives each iteration a cold-ish start — for
5 iterations of 10 s (the hook's time budget, not Flashlight's default of 10), renders
`flashlight report`, and prints a summary. `results.json`, `report/` and a `README.txt` upload as
**Flashlight (android)**. It is **informational** (`--no-fail`: a skip or a failed run is a
notice, never a red job; no budget) and **opt-in** behind the `FLASHLIGHT` repo constant
(`disabled`) in the `IOS_MODE` idiom: a `workflow_dispatch` input whose `default` equals the
`|| 'disabled'` literal. The literal is passed to the step as `env.FLASHLIGHT` and the script
gates on it rather than a step `if`, so the upload step always has a directory and an expression
that does not resolve at runtime degrades to "skipped", not to a failed hook. No custom job, no new
workflow, no iOS.

## Consequences

- One dispatch (`-F flashlight=enabled`) gives a PR a release-build CPU / RAM / FPS report with no
  extra build, boot or install; flipping the default runs it on every PR for about five extra
  flow runs of hook time.
- Numbers are relative: comparable only run-to-run on the same worker class
  (`linux-large-nested-virtualization`) or the same laptop, never to a phone. Compare with
  `flashlight report a.json b.json`.
- Nothing has run on EAS yet: `eas workflow:validate` accepts the file, the script's pure parts are
  unit-tested, and the local path needs an Android emulator with the e2e build. Whether `adb` /
  `maestro` are on PATH inside the hook, whether the installer works on the worker, and whether
  the profiler sees the emulator's app process are confirmed on the first enabled run — every one
  of those is a printed skip, not a failure.
- `docs/performance.md` gains a layer row and section; `docs/native-e2e.md` an artifact row;
  `docs/ci-overview.md` a constant row.

### Rejected

- **A custom `linux` job that boots its own emulator and installs the build** — duplicates what
  the maestro job already does (download, install, boot) for a second copy of the same device.
- **A budget / gate now** — the run-to-run spread on an emulator is unknown; a threshold picked
  before a baseline would only add noise to the PR check.
- **Flashlight Cloud** — app-start only, a separate account, and it does not run the project's own
  Maestro flows.
- **Retiring D4** — loses the single pre-release, on-device signal the perf story has; the cost of
  keeping it as an opt-in hook is one script and two steps.
- **Profiling the whole workspace** — four flows × N iterations does not fit a hook; one
  representative flow per run does, and the flow is a `--flow` flag away from changing.

### Follow-ups

- First enabled run: confirm PATH / installer / profiler on the worker, record findings in
  `docs/performance.md`, and open an issue for anything that turned into a skip.
- After a handful of runs: a baseline plus `flashlight-budget.json` and a gate in the style of
  `observe-budget.json` / `observe:check`, once the variance is known.
- Revisit the tool choice if Flashlight has had no release by mid-2027.
