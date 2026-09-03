import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';

/** How long cached queries survive in memory and on disk. Must be >= persister maxAge. */
export const QUERY_GC_TIME = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Single app-wide QueryClient. Kept in its own module (not inside a provider) so
 * devtools such as the Rozenite TanStack Query plugin can attach to it later.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: QUERY_GC_TIME,
      retry: 2,
    },
  },
});

/**
 * AsyncStorage-backed persister. On web AsyncStorage is backed by localStorage,
 * so the same persister works across every platform.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'expo-boilerplate-query-cache',
  throttleTime: 1000,
});

/**
 * Cache buster: bumping the app version discards any persisted cache whose shape
 * may no longer match what the code expects.
 */
export const queryCacheBuster = `v${Constants.expoConfig?.version ?? '0'}`;
