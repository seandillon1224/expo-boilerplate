# EAS Observe: production perf telemetry and the TTI check

[EAS Observe](https://docs.expo.dev/eas/observe/) is the production performance telemetry
(PLAN.md decision 7: Observe for perf, Sentry for errors, Sentry tracing off). `expo-observe`
measures startup and navigation on real installs and ships the samples to the EAS project; this
page is how to read them and how to hold a release to a startup-TTI budget.

Tooling: `src/lib/observe.ts` (the one place the SDK is configured), `observe-budget.json` (the
thresholds), `scripts/observe-check.js` (`bun run observe:check`, the pass/fail rule),
`.eas/workflows/observe-check.yml` (the on-demand / cron run) and the informational `observe` job in
`.eas/workflows/deploy-staging.yml`.

## What Observe collects here

| Metric                              | Alias                                       | Where it comes from                                                                                                                     |
| ----------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Cold / warm launch                  | `cold_launch` / `warm_launch`               | Native, automatic. Cold launch is process start → first frame; JS cannot change it.                                                     |
| Bundle load                         | `bundle_load`                               | Automatic: Hermes bytecode load + evaluation before `runApplication`.                                                                   |
| Time to first render                | `ttr`                                       | Automatic once the root is wrapped: `wrapObserveRoot` (`ObserveRoot.wrap`) in the root layout marks the first React render.             |
| **Time to interactive**             | **`tti`**                                   | **Manual.** Fires when a screen calls `markInteractive()` — see the contract below. Carries frame-rate, device and network params.      |
| Navigation cold / warm TTR, nav TTI | `nav_cold_ttr` / `nav_warm_ttr` / `nav_tti` | The Expo Router integration (`integrations: { 'expo-router': true }`) tags every metric with the route and times navigations per route. |
| Update download                     | `update_download`                           | `expo-updates` download time for OTA updates.                                                                                           |

Durations are seconds in the CLI and JSON; `observe-budget.json` is in milliseconds and the
script converts. Data is retained for at least 60 days.

**Who reports.** `configureObserve()` runs once at module scope in the root layout, before the
first render (the router integration cannot be toggled later):

- `dispatchInDebug: false` — dev clients and any `__DEV__` bundle never send. Only staging / UAT /
  production builds (release JS) report. Expo Go has no native module; web is a no-op.
- `sampleRate` — 1 (every install) for `development` / `staging` / `uat`, `0.25` for
  `production`. Deterministic per install: an install is either always in or always out.
- `environment` — the `APP_VARIANT`, stored as metadata on every event. It does **not** filter
  `observe:metrics-summary` (see _Querying from the CLI_), it is visible per sample and per session.
- Dispatch only happens when `extra.eas.projectId` is set, i.e. `EAS_PROJECT_ID` in
  `app.config.ts` — the same id EAS Build / Update use.
- Events are buffered on the device and flushed when the app backgrounds (or on
  `Observe.dispatchEvents()`), so a launch shows up on expo.dev minutes later, not instantly.

## The `markInteractive` contract (what TTI means for this app)

`expo.app_startup.tti` is measured from native process start to the first `markInteractive()`
call of the session; it includes cold launch, bundle load and first render. It is the one metric
the app defines itself, so the rule is:

- Every screen that loads data calls `markInteractive` from `useObserve()` **once its content is
  usable** — data rendered, or an empty / error state the user can act on. Never while a
  `LoadingState` is showing: that would report the skeleton as "interactive" and hide the
  regression the budget exists to catch.
- Static screens need nothing: `ObserveRoot` already marks them as rendered (TTR), and a session
  with no `markInteractive` call simply has no TTI sample.
- One call per session counts. Extra calls from later screens are ignored for startup TTI (the
  router integration measures those as navigation TTI instead).

The seed is `src/app/(tabs)/(home)/fetch.tsx`: `markInteractive()` runs in an effect gated on
`isInteractive` (query settled, either a list or an empty state). Use it as the template.

## Querying from the CLI

All commands use the repo-pinned CLI (`bun run eas …`), need an EAS session (`bun run eas login`,
or `EXPO_TOKEN`), read the project id from `app.config.ts`, and take `--days N` /
`--start` / `--end`, `--platform ios|android`, `--json` (implies `--non-interactive`). Default
window: 60 days.

```sh
# Aggregates per app version (and build number) — the check's data source.
bun run eas observe:metrics-summary --metric tti --stat median --stat p90 --stat eventCount --days 7
bun run eas observe:metrics-summary --metric tti --metric cold_launch --platform ios --days 14 --json

# Individual samples: find the slow sessions behind a bad p90.
bun run eas observe:metrics tti --sort slowest --days 7 --limit 20
bun run eas observe:metrics tti --update-id <update-id> --sort slowest --json   # one OTA group

# Per-route navigation aggregates (needs the expo-router integration — on here).
bun run eas observe:routes --metric nav_tti --stat median --stat p90 --days 7
bun run eas observe:routes --route-name "(tabs)/(home)/fetch" --days 7

# Which app versions / builds / update groups are in the field, with sample counts.
bun run eas observe:versions --days 30
```

`observe:metrics-summary` has no per-update or per-environment filter: it aggregates every
version seen in the window, both variants included (a staging build and a production build with
the same `version` land in the same row; `updateIds` on the row lists the OTA groups that
contributed). `observe:metrics` and `observe:routes` do filter by `--update-id` /
`--app-version`, and `observe:session <id>` replays one session end to end (`sessionId` is in
every `--json` sample). Custom events (`Observe.logEvent`) would appear under `observe:events`;
the template emits none.

## The check: `bun run observe:check`

```sh
bun run observe:check                          # tti, last 7 days, both platforms, every version
bun run observe:check --platform ios --days 3  # a short staging soak
bun run observe:check --version 1.2.0          # only the version about to be promoted
bun run observe:check --update-id <group-id>   # only version rows that include this OTA group
bun run observe:check --strict                 # gate mode: no data / no session = failure
bun run observe:check --input scripts/__tests__/fixtures/observe-summary-breach.json   # offline
```

What it does: runs `eas observe:metrics-summary --metric tti … --json`, converts each
(version, platform) row to milliseconds and compares the statistics named in
`observe-budget.json` against their limits. Output is one line per row (`OK` / `FAIL` / `SKIP`),
a Markdown table in `$GITHUB_STEP_SUMMARY` when set, and:

| Situation                                                                     | Exit | Why                                                                                        |
| ----------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| Every evaluated row within budget                                             | 0    |                                                                                            |
| Any row with ≥ `minSamples` events over a limit                               | 1    | The breach. Rows are listed with the offending statistic.                                  |
| A row with < `minSamples` events (whatever its numbers)                       | 0    | `insufficient` — a handful of tester launches is not a distribution. Reported, not failed. |
| No rows in the window, no EAS session, no project id, Observe not on the plan | 0    | Skipped with a notice so the template stays green before Observe is set up.                |
| Any of the above with `--strict` / `OBSERVE_CHECK_STRICT=1`                   | 1    | For use as a gate: silence is a failure.                                                   |
| `eas-cli` fails for any other reason                                          | 1    | Something to fix (network, expired token, CLI change).                                     |

`--input <file>` evaluates a saved `--json` report instead of calling the CLI (the unit tests in
`scripts/__tests__/observe-check.test.ts` run the thresholding this way, no network);
`--dry-run` is accepted as an alias for readability.

### Thresholds: `observe-budget.json`

```json
{
  "unit": "ms",
  "metric": "tti",
  "minSamples": 30,
  "ios": { "median": 2000, "p90": 3000 },
  "android": { "median": 2500, "p90": 3500 }
}
```

- Keys under a platform are the statistics `metrics-summary` returns: `median`, `average`,
  `p80`, `p90`, `p99`, `max` (there is no p50 / p75 — `median` is p50). Add or drop any; a
  platform with no keys is reported as `no-limits` and never fails.
- The starting values follow Expo's published targets (TTI < 3 s including cold launch) with the
  median tightened to what a fetch-and-list screen should manage; Android gets 500 ms more for
  the wider device population. Re-base them after the first real week of data: run
  `bun run eas observe:metrics-summary --metric tti --days 14` and set each limit to the observed
  value + ~15 %, then tighten as the app improves.
- `minSamples` is per (version, platform) row. 30 is a few days of a handful of staging testers;
  raise it for production-only gating.
- `metric` can be any alias (`ttr`, `cold_launch`, `nav_tti`, …) if a team prefers to gate on
  something the app does not have to instrument, at the cost of measuring less.
- Raise a limit only with a justification in the PR, like `bundle-budget.json`.

## Gating on TTI: staging soak → check → promote

The ladder ([release ladder](release-ladder.md)) already promotes a staging update group to UAT
and production behind an approval. The TTI check slots in front of that approval; it is
deliberately **not** automatic, because Observe measures real launches and the check needs a soak
to have anything to measure.

1. **Merge to `main`.** `deploy-staging.yml` publishes the group. Its `observe` job runs
   `bun run observe:check --days 7` right away — that reading is the soak of the _previous_
   group(s) (nothing has launched the new one yet) and it never fails the run; treat it as
   "was staging healthy before this landed". It is skipped-with-notice until Observe reports.
2. **Soak.** Testers use the staging build for a day or more. Samples arrive as sampled installs
   launch and background.
3. **Check.** Before promoting: `bun run observe:check --days <soak> --version <app version>`
   locally, or `bun run eas workflow:run .eas/workflows/observe-check.yml -F days=3 -F version=…`
   for a run log on expo.dev. Narrow with `--update-id <staging group id>` (the id `promote.yml`
   resolves, or `bun run eas update:list --branch staging --limit 1 --json`). Investigate a
   `FAIL` with `bun run eas observe:metrics tti --update-id <id> --sort slowest`, then
   `observe:session <sessionId>` for the worst one: high `totalDelay` and `slowFrames` = main-thread
   contention, `frozenFrames` = a blocking call, a long `network.requests.slowest.duration` = a
   startup request to defer.
4. **Promote** (`promote.yml -F target=uat|production`). The approver on expo.dev runs or reads the
   check before clicking Approve.

**Making it a hard gate.** Two options, once the budget has been re-based on real data:

- _Reviewer rule_ (no YAML change): the `require-approval` reviewer in `promote.yml` approves only
  after a green `Observe check` run for the group's version within the soak window. Write it into
  the team's promotion checklist.
- _Job in `promote.yml`_: add a custom job between `resolve` and `approve` (`needs: [resolve]`,
  `approve.needs: [resolve, observe]`) that exports `EXPO_TOKEN` from
  `${ eas.job.secrets.robotAccessToken }` (same idiom as `resolve`) and runs
  `bun run observe:check --strict --days <soak> --update-id "$GROUP"` with
  `GROUP: ${{ needs.resolve.outputs.group_id }}` in `env`. A breach or missing data then fails
  the run before anyone can approve. `promote.yml` sits at the 16 KiB validator cap, so trim a
  comment block or move the Slack job's message composition to a script first; validate with
  `bun run eas workflow:validate .eas/workflows/promote.yml`.

Either way, keep `deploy-staging.yml`'s job informational: gating the staging rung on the
previous group's numbers would block every fix for a regression behind the regression itself.

**Cron.** `observe-check.yml` has a commented `schedule` (weekdays 07:00 GMT). Uncomment it once
Observe has data so every day starts with a run log; leave it off before that, it would only
print skips.

## Troubleshooting

| Symptom                                                       | Cause / fix                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no tti samples in the window — skipping`                     | Nothing has reported yet. Only release-JS installs report (`dispatchInDebug: false`), so a dev client on the simulator never counts; install the **staging** build ([install guide](install-staging-app.md)), launch it, open the fetch screen, background the app, wait a few minutes, re-run with `--days 1`. |
| Samples exist but no `tti` rows (TTR / cold launch appear)    | No screen called `markInteractive` in those sessions. Only screens that load data mark it; a session that never left the home tab has no TTI. Check the fetch screen was opened, then that the screen's `useObserve().markInteractive()` runs once its content is usable.                                       |
| `no EAS session … skipping`                                   | Not logged in and no `EXPO_TOKEN`. Locally `bun run eas login`; on EAS the workflow exports the run's robot token; on GitHub Actions the `EXPO_TOKEN` repository secret ([environments and secrets](environments-and-secrets.md#human-setup-checklist-owner)).                                                  |
| `no EAS project id … skipping`                                | `EAS_PROJECT_ID` in `app.config.ts` is empty (a fresh template before `eas init`) — link the project, or pass `--project-id <uuid>` / `EAS_PROJECT_ID=<uuid>`. The same id gates dispatch in the app: without it, installs never send anything either.                                                          |
| `EAS Observe is not included in this account plan — skipping` | Observe is a paid EAS feature above the free tier's limits; the CLI's message links the billing page. Nothing in the repo is wrong.                                                                                                                                                                             |
| Every row `insufficient`                                      | Fewer than `minSamples` launches per (version, platform). Widen `--days`, wait, or lower `minSamples` for a small team (30 → 10) knowing p90 on 10 samples is noise.                                                                                                                                            |
| Production numbers look thin                                  | `sampleRate` is 0.25 in production by design (`src/lib/observe.ts`); one in four installs reports, deterministically. Raise it if volume is low, lower it if the plan's event quota bites.                                                                                                                      |
| Staging and production mixed in one row                       | `metrics-summary` groups by app version, not environment. Bump `version` per release (the store release does), or gate on `observe:metrics --update-id` output instead of the summary.                                                                                                                          |
| A breach right after a new native build                       | Cold launch is native: a new build with more native modules or a bigger binary moves TTI without any JS change. Compare `cold_launch` and `bundle_load` for the same versions to split native from JS time.                                                                                                     |
| `eas-cli exited 1` with anything else                         | Read the CLI error; `--json` output goes to stdout and messages to stderr, both are printed. An `eas-cli` bump can rename a stat or flag — the accepted ones are in `bun run eas observe:metrics-summary --help`.                                                                                               |
