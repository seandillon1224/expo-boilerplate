# Testing

PLAN.md decision 6 fixes the tools: **Jest + `jest-expo` + React Native Testing Library** for unit
and component tests, **Maestro** for end-to-end on iOS, Android and web, no Playwright. Decision 7
adds **Reassure** for render-time regressions. This page is the pyramid as built: what each layer
covers, where its files live, how to write one more, and what runs where.

| Layer               | Files                              | Runner                                                          | Runs in                                                                       | Doc                                               |
| ------------------- | ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Unit / component    | `src/**/__tests__/*.test.{ts,tsx}` | `bun run test` (Jest, `jest-expo` preset)                       | Locally on demand; CI `Unit tests` (required)                                 | this page                                         |
| Script tests        | `scripts/__tests__/*.test.ts`      | Same Jest run                                                   | Same                                                                          | this page                                         |
| Render perf         | `src/__perf__/*.perf-test.tsx`     | `bun run perf` (Reassure's own Jest invocation)                 | Locally before a costly change; CI `Perf (Reassure)` (PR-only, informational) | [Render-perf tests](perf-tests.md)                |
| E2E web             | `.maestro/flows/web/*.yaml`        | `bun run e2e:web` (Maestro CLI, Chromium)                       | Locally against `bun run serve:web`; CI `Maestro web` (required)              | this page, [Native E2E](native-e2e.md)            |
| E2E native          | `.maestro/flows/*.yaml`            | `bun run e2e:ios` / `e2e:android` (Maestro on a repacked build) | Locally on a laptop; EAS `E2E (native)` on every PR                           | [Native E2E](native-e2e.md)                       |
| Template end-to-end | `scripts/template-e2e.js`          | `bun run template:e2e`                                          | CI `Template init` (required); locally when touching init or the manifest     | [Template init](template-init.md#end-to-end-test) |

Where the runs come from, per check, is in [CI overview](ci-overview.md).

## Unit and component tests (Jest)

`jest.config.js` uses the `jest-expo` preset, `testMatch: ['**/__tests__/**/*.test.{ts,tsx}',
'**/*.test.{ts,tsx}']`, and a `.css` mapper so NativeWind's `global.css` import resolves. Coverage
comes from `src/**/*.{ts,tsx}` minus layouts, `.d.ts`, tests and perf tests; `bun run test:coverage`
writes `coverage/` (lcov + text summary) and CI uploads it with a JUnit report (`jest-junit` is
added only when `CI` is set). `bun run test:watch` for a loop.

Layout on `main`:

| Directory                   | What is there                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `src/__tests__/screens/`    | One test per route: `home`, `settings`, `fetch` (query states + `markInteractive`), `updates` |
| `src/__tests__/components/` | `states` (`LoadingState` / `EmptyState` / `ErrorState`), `error-boundary`                     |
| `src/__tests__/features/`   | Hooks: `use-update-policy`                                                                    |
| `src/__tests__/i18n/`       | Locale fallback and `useTranslation` rendering                                                |
| `src/lib/__tests__/`        | Pure modules next to their source: `env.schema`, `observe`, `sentry`                          |

### Rules that bite

- **RNTL v14: `render`, `renderHook`, `rerender` and `unmount` are async.** Always `await` them;
  a missing `await` shows up as "not on the screen" for an element that is clearly rendered.
- Query by `testID` (`screen.getByTestId`) for anything a Maestro flow also selects, and by text
  for copy — the same `t()` strings the app renders, since `jest.setup.ts` registers the real
  `en` catalog.
- Wrap state changes in `act`; when TanStack Query is involved, flush its macrotask inside the
  `act` (see `press()` in `src/__tests__/screens/fetch.test.tsx`).
- No real network: replace `globalThis.fetch` with a `jest.fn()` per test and restore it in
  `afterEach`.
- Fresh `QueryClient` per render with `retry: false` and `gcTime: Infinity`, cleared in
  `afterEach`, so no cache or timer leaks between tests.

### What `jest.setup.ts` already mocks

Every test (and every Reassure perf test) gets these without any local `jest.mock`:

| Module                                      | Mocked as                                                                                                                 | Use it for                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@react-native-async-storage/async-storage` | The package's in-memory Jest mock                                                                                         | Persisted query cache, anything else stored                                                         |
| `expo-localization`                         | Device locale `fr-FR` (no bundled catalog)                                                                                | Proving the `en` fallback; `i18n.language` is `fr`, `resolvedLanguage` is `en`                      |
| `@/lib/devtools`                            | `useDevTools` is a no-op                                                                                                  | Root layout renders without Rozenite                                                                |
| `@sentry/react-native`                      | `init`, `captureException`, `setTag`, `setContext`, `flush` as `jest.fn()`; `wrap` is identity                            | `expect(jest.mocked(Sentry.captureException)).toHaveBeenCalledWith(...)`                            |
| `expo-observe`                              | `useObserve()` returns one shared `markInteractive` spy; root HOC and `configure` are inert                               | Assert a screen marks interactivity once content is usable and never while loading                  |
| `expo-updates`                              | The "updates disabled" shape of a dev client (`isEnabled: false`, `useUpdates()` embedded launch, async actions resolved) | Flip `isEnabled` per test for the enabled path (`src/__tests__/features/use-update-policy.test.ts`) |

`@/i18n` is imported for real (the `en` catalog is registered) and RNTL's matchers
(`toBeOnTheScreen`, `toHaveTextContent`) are auto-registered.

### Mocking conventions

- **Env**: `@/lib/env` parses `process.env` at import time. To test a module under a different
  `EXPO_PUBLIC_*` value, set the variable, load the module inside `jest.isolateModules`, and restore
  the variable in `finally` — the `loadObserve()` helper in `src/lib/__tests__/observe.test.ts` is the
  pattern. Never mutate `env` exports directly.
- **i18n**: do not mock `react-i18next`; render through the real catalog and assert on the English
  copy. A missing key renders the key itself, which fails the text assertion for you.
- **TanStack Query**: never mock the library. Provide a `QueryClientProvider` with a throwaway
  client and mock `fetch` (`renderWithQuery()` in `fetch.test.tsx`). `screen.findBy*` waits for the
  query to settle.
- **Native modules**: add a new global mock to `jest.setup.ts` only when every test needs it (a
  module imported by the root layout or a provider). Otherwise `jest.mock` at the top of the one
  test file.
- **`__DEV__`**: a Metro global that Jest also defines; flip it through
  `(globalThis as { __DEV__: boolean }).__DEV__` and restore it in `afterEach`.

### Writing a new component test

`src/__tests__/components/states.test.tsx` is the template:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState } from '@/components/states';

describe('EmptyState', () => {
  it('renders custom copy and an action that fires onPress', async () => {
    const onPress = jest.fn();
    await render(
      <EmptyState
        testID="posts-empty"
        title="No posts yet"
        action={{ label: 'Create one', onPress, testID: 'posts-create' }}
      />,
    );
    expect(screen.getByTestId('posts-empty')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('posts-create'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

A screen test is the same shape with the route module as the subject
(`import HomeScreen from '@/app/(tabs)/(home)/index'`); a data screen additionally asserts the
loading → content transition and `markInteractive` (see `fetch.test.tsx`). A hook uses
`await renderHook(() => useX())` and `result.current`.

## Script tests

`scripts/*.js` are plain Node (no `@types/node`; `require` with an eslint-disable line) and are
tested from `scripts/__tests__/*.test.ts` by the same Jest run: `init` (the rewrite / removal
manifests against the checked-in files — the drift guard), `doctor`, `observe-check` (JSON fixtures
in `scripts/__tests__/fixtures/`), `repo-settings`. The pattern is to export the pure pieces
(`parseArgs`, `DESIRED`, `collectDrift`, ...) and inject the shell: `repo-settings.test.ts` builds a
fake `gh` that records every call and returns canned responses, so nothing touches the network. A
new script gets the same treatment: export the logic, take the process runner as a parameter,
and test the decisions, not the spawning.

## Render-perf tests (Reassure)

`src/__perf__/*.perf-test.tsx` measure render duration and count with `measureRenders` /
`measureFunction` and compare a current run to a baseline statistically. Jest never matches them;
`bun run perf` runs them with Reassure's own `--testMatch` on top of `jest.config.js`, so every mock
above applies. Locally: `bun run perf:baseline` on the base commit, `bun run perf` on your branch,
`bun run perf:gate` for the CI verdict. Writing one, reading `.reassure/output.md`, what the gate
fails on: [Render-perf tests](perf-tests.md).

## End-to-end tests (Maestro)

`.maestro/` is one Maestro workspace: shared steps live once in `subflows/steps/<name>.yaml`, and
each flow has two thin entries — `flows/<name>.yaml` (`appId: ${MAESTRO_APP_ID}`,
`tags: [ios, android]`) and `flows/web/<name>.yaml` (`url: ${APP_URL}`, `tags: [web]`). Four flows
ship: `smoke`, `tabs`, `fetch`, `updates`. Always run the workspace directory (`maestro test
.maestro`) so `config.yaml` is read; the scripts do.

| Lane   | Command                                                                                      | App under test                                                                | Where it runs in CI                                                  |
| ------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Web    | `bun run export:web && bun run serve:web` in one shell, `bun run e2e:web` in another         | The static export on `http://localhost:8081`                                  | `Maestro web` in `.github/workflows/ci.yml` (required)               |
| Native | `bun run e2e:build --platform <p>` → `bun run e2e:repack --platform <p>` → `bun run e2e:<p>` | A release-mode EAS build for the current fingerprint with your JS repacked in | `E2E (native)` in `.eas/workflows/e2e.yml`, both platforms, every PR |

Rules:

- **Select by `testID` only.** `id:` is the accessibility identifier on iOS, resource-id on
  Android and DOM id on web, so one step file serves all three. The lint rule
  `local/require-testid` makes every pressable and input carry one; the states components pass
  `testID` through so screens can name their own (`fetch-loading`, `fetch-retry`). The single
  exception is the tab bar, isolated in `subflows/select-tab.yaml`.
- **Never select by text**: copy changes with i18n and platform.
- **Flaky flows get quarantined, not weakened.** No deleted assertions, no `sleep`, no stretched
  timeouts. Green-on-retry twice in a week → file a `flaky-flow` issue, add the `quarantine` tag
  to the entry file, fix within two weeks or delete the flow:
  [Native E2E → Flake budget](native-e2e.md#flake-budget).
- Reports land in `maestro-<lane>/` locally (JUnit `report.xml`, `debug/` with failure screenshots
  and `maestro.log`) and as run artifacts in CI: [Failure artifacts](native-e2e.md#failure-artifacts).

Adding a flow is three files (steps subflow, native entry, web entry); the walkthrough with the
exact headers is [Native E2E → Adding a flow](native-e2e.md#adding-a-flow). A minimal steps file:

```yaml
# .maestro/subflows/steps/settings.yaml — the app opens Settings from the tab bar.
appId: ${MAESTRO_APP_ID}
---
- runFlow:
    file: ../select-tab.yaml
    env:
      TAB: settings
      TAB_LABEL: Settings
- assertVisible:
    id: settings-screen
```

## The template end-to-end test

`bun run template:e2e` copies the checkout to a temp directory, runs the documented headless
`bun run init --fresh-git` there with no EAS project and no `EXPO_TOKEN`, then runs the JS gate on
the generated project's first commit and fails on any leftover template identifier. It is the
`Template init` required check and the reason new files must not carry the template's own name,
slug, bundle id or account except where `scripts/init.js` rewrites them:
[Template init → End-to-end test](template-init.md#end-to-end-test).

## What runs where

| Moment                 | What                                                                                                                                       | Wired in                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `git commit`           | ESLint `--fix` and Prettier on staged files; commitlint on the message                                                                     | `lefthook.yml` (`pre-commit`, `commit-msg`)                   |
| `git push`             | `typecheck`, `knip`, `env:check`, `i18n:check` — no tests, to keep pushes fast                                                             | `lefthook.yml` (`pre-push`)                                   |
| Before a PR            | `bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check`; `bun run e2e:web` when a flow or screen changed | you                                                           |
| PR / push to `main`    | `Unit tests` (with coverage), `Maestro web`, `Template init`, the rest of the gate; `Perf (Reassure)` on PRs; `E2E (native)` on EAS        | [CI overview](ci-overview.md)                                 |
| Before a costly change | `bun run perf:baseline` on `main`, `bun run perf` on the branch                                                                            | [Render-perf tests](perf-tests.md)                            |
| Native lane red        | `bun run e2e:build` / `e2e:repack` / `e2e:<p>` on a laptop                                                                                 | [Native E2E → Local reproduce](native-e2e.md#local-reproduce) |

What is deliberately not here: snapshot tests (they assert markup, not behaviour, and churn with
every styling change), Storybook (PLAN.md decision 14), Playwright (Maestro covers web), and a
coverage threshold (coverage is uploaded for reading, not gated; add a `coverageThreshold` in
`jest.config.js` when a project wants one).
