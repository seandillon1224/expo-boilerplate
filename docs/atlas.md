# Expo Atlas

[Expo Atlas](https://github.com/expo/expo-atlas) is the bundle inspector built into Expo CLI
(SDK 51+). It records what Metro put into each bundle and serves a UI to explore it: total size
per platform, size by folder / package / file type, and, for any module, which files import it and
what it imports. `bun run budget` tells you a bundle is too big; Atlas tells you **why**.

PLAN.md decision 7 owns the choice; this page is the how-to.

## When to reach for it

- A `Bundle budget` CI job failed (or `bun run budget` locally) and you need to know what grew.
- A dependency looks heavier than expected, or you want to confirm tree-shaking actually dropped a
  code path (e.g. that `@rozenite/*` or `@sentry/react-native` web replay is absent from a release bundle).
- You are picking between two libraries and want the real, per-platform cost inside this Metro config
  (Sentry serializer, NativeWind, Hermes bytecode on native).

## Running it

Atlas is gated on the `EXPO_ATLAS=true` environment variable read by Expo CLI (`expo start` and
`expo export`). It is never set by the scripts, CI or EAS Workflows, so a plain `bun run start`,
`bun run export:*`, EAS Build and EAS Update produce exactly the bundles they did before.

### Against the dev server (`bun run atlas`)

```sh
bun run atlas          # EXPO_ATLAS=true bun run start (Rozenite stays on, see docs/rozenite.md)
```

Open **http://localhost:8081/_expo/atlas** (`expo-atlas` registers as a dev-tools plugin, so it is
also listed under `shift+m` in the CLI). Atlas fills in as you load platforms: press `i` / `a` / `w` (or open the dev client / browser)
and each platform's bundle appears in the platform switcher once Metro has served it. Data reflects
the **development** bundle (`__DEV__` code included, nothing minified), so use it for "who imports
this" questions, not for sizes.

To see release sizes while still using the dev server: `EXPO_ATLAS=true bun run start --no-dev --minify`.

### From a release export (`bun run atlas:export`)

```sh
bun run atlas:export            # all platforms → one Atlas with a platform switcher
bun run atlas:export:web        # or :ios / :android
bun run atlas:serve             # re-open the last export without re-bundling
```

`atlas:export` runs `expo export` with Atlas on into `dist-atlas/` (kept separate from the
`dist-<platform>/` folders the budget scripts read), which writes `.expo/atlas.jsonl`, then runs the
`expo-atlas` CLI to serve that file and open the browser. Pass `-- --no-open` or `-- --port 4000` to
change that (the flags reach the `expo-atlas` command). `.expo/` and `dist-*/` are gitignored; the
atlas file is overwritten on every export.

This is the mode to trust for sizes: same production `NODE_ENV`, minification and Hermes bytecode as
`bun run export:*` (only the bundle bytes Atlas reports are pre-Hermes JS, so they will not equal the
gzip `.hbc` numbers in `bundle-budget.json`; compare relative sizes, not absolutes).

## Reading it

The UI is three pages per bundle (the Atlas CLI redirects `/` to the first one):

- **Bundle overview** (`/<bundle>`): platform and entry switchers at the top (native apps have one
  entry; the web export has one per route chunk), total size and module count, and a **treemap** of
  every module grouped by folder. Big rectangles under `node_modules/` are the first thing to look at
  after a budget failure.
- **Folder page** (`/<bundle>/folders/<path>`, click a folder in the treemap): the same treemap
  scoped to that folder, so you can tell whether one package or many small ones grew.
- **Module page** (`/<bundle>/modules/<path>`, click a file): its size, **Modules imported** (what it
  drags along), **Imported by modules** (who pulled it in; walk this up to the `src/` file responsible)
  and the **Module content** with a **Source** / **Output** toggle (what you wrote vs what Metro
  emitted). Removing the import at the top of an _imported by_ chain drops the whole subtree if
  nothing else references it.
- **Filter** (top right → "Filter modules"): _file glob to include_ / _exclude_, e.g. include
  `**/node_modules/@tanstack/**` to answer "what does this dependency cost in total"; the treemap and
  totals update in place. **Reload bundle** (dev server mode) picks up the latest Metro build.

## Atlas vs `bundle-budget.json`

| Question                                     | Tool                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Did this PR make a bundle too big?           | `bun run budget` / CI `Bundle budget (<platform>)` job — gzip size vs `bundle-budget.json` |
| What grew, and which import caused it?       | Atlas (`bun run atlas:export`, then the treemap / _Imported by modules_)                   |
| Is a dev-only module leaking into a release? | Atlas on a release export, filter by the package name                                      |
| Where do I raise the limit?                  | `bundle-budget.json` — with the Atlas finding as the justification in the PR               |

The budget is the gate (required check, exits 1); Atlas is the diagnosis (local, on demand). Neither
ever runs in EAS Build: the CI job sets no `EXPO_ATLAS`, and `eas.json` profiles / `.eas/workflows`
do not either.

## Rozenite panel (not wired)

Rozenite ships an official [`@rozenite/expo-atlas-plugin`](https://www.rozenite.dev/docs/official-plugins/expo-atlas)
that embeds the same UI as a React Native DevTools panel. It is not added here: it mounts its own
`/_expo/atlas` middleware (duplicating what Expo CLI already does under `EXPO_ATLAS=true`) and
installs its own Metro `customSerializer`, which would have to be reconciled with the Sentry Debug ID
serializer in `metro.config.js`. The browser URL above gives the same information with no extra
Metro layer; revisit if a future Rozenite release drops the serializer override.
