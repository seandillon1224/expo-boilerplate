import type { QueryClient } from '@tanstack/react-query';

type UseDevTools = (queryClient: QueryClient) => void;

const noop: UseDevTools = () => {};

/**
 * Attaches the Rozenite DevTools plugins (docs/rozenite.md) to the running app.
 * Resolved once at module load, so the hook count never changes between renders.
 *
 * `__DEV__` is inlined by Metro, so production bundles never reference the plugin
 * packages: `require` inside the dead branch is dropped before dependency collection.
 * Web gets the no-op in `devtools.web.ts` (Rozenite targets React Native DevTools).
 */
export const useDevTools: UseDevTools = __DEV__
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./devtools-plugins').useDevTools
  : noop;
