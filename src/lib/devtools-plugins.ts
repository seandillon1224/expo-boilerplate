import { useNetworkActivityDevTools } from '@rozenite/network-activity-plugin';
import { usePerformanceMonitorDevTools } from '@rozenite/performance-monitor-plugin';
import { useTanStackQueryDevTools } from '@rozenite/tanstack-query-plugin';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Dev-only: loaded via `require` from `devtools.ts` behind `__DEV__`, never imported
 * directly. Each hook is inert until React Native DevTools connects.
 * Add project-local plugins here (docs/rozenite.md → Adding a project-local plugin).
 */
export function useDevTools(queryClient: QueryClient): void {
  useTanStackQueryDevTools(queryClient);
  useNetworkActivityDevTools();
  usePerformanceMonitorDevTools();
}
