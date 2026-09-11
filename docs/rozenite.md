# Rozenite DevTools

[Rozenite](https://www.rozenite.dev) (Callstack) is a plugin host for **React Native DevTools**:
each installed plugin adds a panel to the DevTools window a dev client already opens. It is a
dev-server feature (Metro middleware + hooks that are inert until DevTools connects) and never
ships: production bundles do not reference any `@rozenite/*` package (see "Production" below).

PLAN.md decision 7 owns the choice; this page is the how-to.

## What is wired

| Package                                | Panel               | What it shows                                                                                                                                                                    |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@rozenite/tanstack-query-plugin`      | TanStack Query      | Every query / mutation on the app-wide `queryClient` (`src/lib/query-client.ts`): status, data, observers, stale / gc timers, with actions (refetch, invalidate, reset, remove). |
| `@rozenite/network-activity-plugin`    | Network             | Chrome-style network inspector: HTTP / HTTPS (fetch and XHR, including `expo/fetch`), WebSocket and SSE traffic with method, status, timing, headers and bodies.                 |
| `@rozenite/performance-monitor-plugin` | Performance Monitor | Startup timing (native init, bundle parse / execute, first React render) plus custom `react-native-performance` marks, measures and metrics; start / stop sessions and export.   |

Where things live:

- `metro.config.js` — `withRozenite(...)` is the outermost wrapper, gated on `WITH_ROZENITE === 'true'`.
- `src/lib/devtools.ts` — `useDevTools(queryClient)`; resolves to the real hooks behind a `__DEV__` `require`, otherwise a no-op. `devtools.web.ts` is the web no-op (Rozenite targets React Native DevTools).
- `src/lib/devtools-plugins.ts` — the only file that imports `@rozenite/*`; one hook call per plugin.
- `src/app/_layout.tsx` — calls `useDevTools(queryClient)` once in the root layout.
- `react-native-performance` — peer dependency of the performance plugin. It is a native module (autolinked from `devDependencies` under CNG), so adding it changed the native fingerprint: build a new dev client (`eas build --profile development`) before the panel can attach.

## Opening DevTools with plugins

1. Start the dev server: `bun run ios` / `bun run android` / `bun run start` (all set `WITH_ROZENITE=true`).
   The Metro log lists the discovered plugins on boot.
2. Launch the **dev client** (Rozenite needs a dev build; Expo Go is not supported) and let it connect.
3. Open React Native DevTools: press `j` in the Expo CLI terminal (or `shift+m` → "Open React Native DevTools", or the dev menu → "Open DevTools").
4. The plugin panels appear in the DevTools sidebar (one entry per plugin). Reload DevTools (`Cmd+R`) after
   installing a new plugin; restart the dev server after changing `metro.config.js`.

Turn it off for a session with `WITH_ROZENITE=false bun run ios`. `bun run web` never enables it.

Optional `withRozenite` knobs (all in `metro.config.js`): `include` / `exclude` to pick plugins,
`pluginDisplay: 'tabs'` for one DevTools tab per panel, `destroyOnDetachPlugins` to drop a heavy
panel's state when you switch away.

## Production

Three layers keep Rozenite out of anything that ships:

1. `expo export` and EAS Build never set `WITH_ROZENITE`, so `withRozenite` returns the Metro config untouched.
2. `src/lib/devtools.ts` only `require`s the plugin module when `__DEV__` is true; Metro inlines
   `__DEV__` and drops the dead branch before collecting dependencies, so `@rozenite/*` is absent
   from release bundles (`bun run export:ios && grep -c rozenite dist-ios/_expo/static/js/ios/*.hbc` is `0`;
   `bun run budget` is unchanged).
3. The plugins' own entry points also swap to no-ops when `NODE_ENV === 'production'`.

The only production footprint is the `react-native-performance` native module, which is linked into
release binaries but never called.

## Adding a project-local plugin

Rozenite discovers plugins by scanning `package.json` `dependencies` + `devDependencies` and
keeping every package whose root is a built Rozenite plugin. A project-local plugin is therefore
a folder in the repo added as a `link:` devDependency.

1. Scaffold it under `devtools/` (the folder is not part of the app bundle; `src/` is):

   ```sh
   bunx rozenite@latest generate devtools/my-plugin
   cd devtools/my-plugin && bun install
   ```

   You get `rozenite.config.ts` (panels), `src/*.tsx` (panel UI), `react-native.ts` (the app-side
   entry: hooks / `useRozeniteDevToolsClient`), `vite.config.ts`, `package.json` (its `name` is the
   plugin id used in messages).

2. Build it and link it into the app (a `link:` symlink, so rebuilding the plugin does not need
   `bun install`; `bun add -d ./devtools/my-plugin` would copy it instead):

   ```sh
   bun run build          # inside devtools/my-plugin → dist/
   ```

   In the root `package.json`:

   ```json
   "devDependencies": { "@expo-boilerplate/my-plugin": "link:./devtools/my-plugin" }
   ```

   then `bun install`.

3. Register the app side in `src/lib/devtools-plugins.ts` (the only place that imports plugin
   packages), e.g. `useMyPluginDevTools()` from `@expo-boilerplate/my-plugin`. Keep it a hook so
   `useDevTools` stays a fixed hook list.

4. Iterate with hot reload: `bun run dev` inside the plugin (serves the panel at
   `http://localhost:8888` with an in-browser dev host), and in the app
   `ROZENITE_DEV_MODE=@expo-boilerplate/my-plugin bun run ios` so the running app loads the panel
   from that dev server. New panels in `rozenite.config.ts` need a DevTools reload (`Cmd+R`).

5. Housekeeping: the plugin folder is its own package (own lint / test), so add it to `knip.jsonc`
   `ignoreDependencies` only if knip flags the `link:` entry, and to `jest.config.js`
   `testPathIgnorePatterns` if its tests are not Jest.

Plugin API reference: https://www.rozenite.dev/docs/plugin-development/plugin-development.
Official plugins (SQLite, storage, React Navigation, Redux, Expo Atlas, ...): https://www.rozenite.dev/docs/official-plugins/overview.
