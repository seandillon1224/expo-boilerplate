import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { type PropsWithChildren, useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import { QUERY_GC_TIME, queryCacheBuster, queryClient, queryPersister } from '@/lib/query-client';

/**
 * Tell TanStack Query when the app is foregrounded so `refetchOnWindowFocus`
 * works on native. On web the library already listens to visibilitychange.
 * Online status is left at its default (always online); wiring `onlineManager`
 * to NetInfo would add a native dependency and is deliberately omitted.
 */
function useAppStateFocus() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const onChange = (status: AppStateStatus) => focusManager.setFocused(status === 'active');
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, []);
}

export function QueryProvider({ children }: PropsWithChildren) {
  useAppStateFocus();
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: QUERY_GC_TIME,
        buster: queryCacheBuster,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
