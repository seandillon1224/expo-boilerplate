# Render-perf tests (Reassure)

[Reassure](https://callstack.github.io/reassure/) measures how long a component takes to render
under Jest and how many times it renders, then compares a **current** run against a **baseline**
run statistically. It catches the regressions unit tests cannot: an extra re-render from a new
context, a list row that got expensive, a hook that now runs on every keystroke.

PLAN.md decision 7 owns the choice; this page is the how-to. Tooling: `reassure` (CLI + `measure*`
helpers), `scripts/reassure-gate.js` (the pass/fail rule), the `Perf (Reassure)` job in
`.github/workflows/ci.yml`.

## Where things live

| Path                           | What                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/__perf__/*.perf-test.tsx` | Perf tests. Reassure's own `--testMatch` picks them up; `bun run test` never does.                |
| `reassure.setup.ts`            | `configure()` settings (`runs`, `warmupRuns`, `removeOutliers`, `testingLibrary`), with comments. |
| `jest.setup.ts`                | Loads `reassure.setup.ts` only inside Reassure's Jest child (`REASSURE_OUTPUT_FILE` is set).      |
| `.reassure/`                   | Outputs: `baseline.perf`, `current.perf`, `output.json`, `output.md`. Gitignored, never tracked.  |
| `scripts/reassure-gate.js`     | Reads `.reassure/output.json`; exits 1 on a significant slowdown.                                 |

Reassure has no config file: it runs Jest with this repo's `jest.config.js` plus its own test
pattern (`**/__perf__/**`, `*.perf-test.tsx`), so all the unit-test mocks in `jest.setup.ts`
(expo-observe, expo-updates, Sentry, AsyncStorage, i18n) apply to perf tests too.

## Writing a perf test

Create `src/__perf__/<subject>.perf-test.tsx`. Two seeds exist: `home-screen` (a static screen) and
`fetch-screen` (TanStack Query loading -> list, `fetch` mocked).

```tsx
import { screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';

import HomeScreen from '@/app/(tabs)/(home)/index';

describe('HomeScreen', () => {
  it('renders and is queryable', async () => {
    await measureRenders(<HomeScreen />, {
      scenario: async () => {
        await screen.findByTestId('home-screen');
      },
    });
  });
});
```

- **`measureRenders(element, options?)`** renders the element `warmupRuns + runs` times and records
  duration and render count per run. `options.scenario` runs after each mount and is part of the
  measurement, so put interactions there (`fireEvent.press`, `findByTestId`, a query resolving).
  `options.wrapper` wraps the element (providers); `options.runs` / `warmupRuns` override the
  defaults for one test.
- **`measureFunction(fn, options?)`** and **`measureAsyncFunction(fn, options?)`** time plain
  (a)sync code the same way: a selector, a reducer, a parser. Same `runs` / `warmupRuns` options.
- Always `await` the `measure*` call (RNTL v14 `render` is async, and so is Reassure).
- Keep the subject **deterministic**: no real network (mock `globalThis.fetch`, resolve immediately
  or never), no timers that outlive a run, a fresh `QueryClient` per render so no run starts from
  cache (see `fetch-screen.perf-test.tsx`). A scenario that waits for something that may already be
  on screen is a race; use `getBy*` when the state is synchronous.
- One test = one named entry in the report (`describe` + `it` names); renaming a test shows up as
  removed + added, which the gate ignores. Do not assert inside a perf test beyond what the scenario
  needs to reach the state you are measuring; correctness belongs in `src/__tests__/`.

## Running locally

```sh
git stash                 # or check out the base commit / main
bun run perf:baseline     # writes .reassure/baseline.perf
git stash pop
bun run perf              # writes .reassure/current.perf, compares, writes output.json + output.md
bun run perf:gate         # exit 1 on a significant slowdown (what CI enforces)
```

`bun run perf:check` (`reassure check-stability`) measures the same code twice and reports how noisy
your machine is; anything a stable machine reports as significant is a real change. Close heavy
apps before trusting a local result, or raise `runs` for the one test that is noisy.

Both `perf` scripts pass extra flags through to Reassure (`--branch`, `--commit-hash`,
`--testMatch`), and anything after `--` goes to Jest (`bun run perf -- -t FetchScreen`).

## What `perf:gate` fails on

`scripts/reassure-gate.js` reads `.reassure/output.json` and exits 1 only when an entry is in
`significant` **and** its `durationDiff` is positive, i.e. a statistically significant slowdown
(Reassure's z-test over the `runs` samples, after `removeOutliers`). Everything else passes:
speed-ups, `meaningless` changes (inside the noise), render-count changes, added / removed tests,
and a missing `output.json` (no baseline yet on the base branch: the first PR to add a perf test is
not blocked). Any `errors` in the report also fail.

In CI (`Perf (Reassure)`, PR-only) the job measures the PR base commit as the baseline and the merge
commit as current **on the same runner**, so both share its noise, then runs the gate. The report
lands in the job's step summary and the `reassure` artifact. The job is not in the required-check
set (`docs/js-gate.md`): treat a red result as a review signal, not a merge blocker.

## Reading `.reassure/output.md`

Sections, top to bottom:

- **Significant Changes To Duration**: the ones that matter. `3.2 ms -> 4.1 ms (+0.9 ms, +28%)`
  with the count column showing render counts (`2 -> 3` means an extra render per mount).
- **Meaningless Changes To Duration**: measured but inside the noise. Ignore unless the count changed.
- **Render Count Changes**: count changed with no significant duration change. Usually an
  unintended re-render; cheap now, not necessarily later.
- **Render Issues**: Reassure's detected anti-patterns (initial update-after-mount, redundant
  updates) per test.
- **Added / Removed Entries**: tests that exist on only one side (new test, renamed test).
- **Show details** (collapsed): per-run samples, standard deviation, warmup runs, removed outliers
  and a **Stability** percentage per side. Stability above ~30% on a run means the machine, not the
  code, dominated; re-run or use `bun run perf:check`.

`output.json` carries the same data with `significant`, `meaningless`, `countChanged`, `added`,
`removed`, `errors` arrays; that is what the gate script consumes.
