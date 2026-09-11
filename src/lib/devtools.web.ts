import type { QueryClient } from '@tanstack/react-query';

/** Rozenite plugins target React Native DevTools; there is nothing to attach on web. */
export const useDevTools = (_queryClient: QueryClient): void => {};
