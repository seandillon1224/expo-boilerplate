import { focusManager, type QueryClient } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus, Text } from 'react-native';

import { QUERY_GC_TIME, queryCacheBuster, queryClient, queryPersister } from '@/lib/query-client';
import { QueryProvider } from '@/providers/query-provider';

type PersistProps = {
  client: QueryClient;
  persistOptions: { persister: unknown; maxAge?: number; buster?: string };
  children: ReactNode;
};

// The persister writes to AsyncStorage on a timer; the provider's own wiring (which client,
// which persist options) is what this file asserts, so the library component is a recorder.
const persistProps: PersistProps[] = [];
jest.mock('@tanstack/react-query-persist-client', () => ({
  PersistQueryClientProvider: (props: PersistProps) => {
    persistProps.push(props);
    return props.children;
  },
}));

/**
 * Captures the handler `useAppStateFocus` registers so the test can drive it directly:
 * emitting a real AppState change is not part of the public API under Jest.
 */
function captureAppStateHandler() {
  const handlers: ((status: AppStateStatus) => void)[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'change') handlers.push(handler as (status: AppStateStatus) => void);
    return { remove } as ReturnType<typeof AppState.addEventListener>;
  });
  return { handlers, remove };
}

async function renderProvider() {
  return render(
    <QueryProvider>
      <Text testID="query-provider-child">child</Text>
    </QueryProvider>,
  );
}

describe('QueryProvider', () => {
  const originalFocus = focusManager.isFocused();

  afterEach(() => {
    jest.restoreAllMocks();
    persistProps.length = 0;
    focusManager.setFocused(originalFocus);
  });

  it('renders its children under the app-wide query client', async () => {
    await renderProvider();
    expect(screen.getByTestId('query-provider-child')).toBeOnTheScreen();
    expect(persistProps).toHaveLength(1);
    expect(persistProps[0]?.client).toBe(queryClient);
  });

  it('persists through the AsyncStorage persister with maxAge equal to gcTime', async () => {
    await renderProvider();
    const { persistOptions } = persistProps[0]!;
    expect(persistOptions.persister).toBe(queryPersister);
    expect(persistOptions.buster).toBe(queryCacheBuster);
    // A maxAge longer than gcTime would restore entries the client immediately drops.
    expect(persistOptions.maxAge).toBe(QUERY_GC_TIME);
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(QUERY_GC_TIME);
  });

  it('mirrors AppState into the TanStack Query focus manager on native', async () => {
    const { handlers } = captureAppStateHandler();

    const { unmount } = await renderProvider();

    expect(handlers).toHaveLength(1);
    const onChange = handlers[0]!;

    await act(async () => onChange('background'));
    expect(focusManager.isFocused()).toBe(false);

    await act(async () => onChange('active'));
    expect(focusManager.isFocused()).toBe(true);

    await act(async () => onChange('inactive'));
    expect(focusManager.isFocused()).toBe(false);

    await unmount();
  });

  it('removes the AppState subscription on unmount', async () => {
    const { remove } = captureAppStateHandler();

    const { unmount } = await renderProvider();
    expect(remove).not.toHaveBeenCalled();

    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('queryCacheBuster', () => {
  function loadBuster(expoConfig: { version?: string } | null): string {
    let buster = '';
    jest.isolateModules(() => {
      jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      buster = (require('@/lib/query-client') as typeof import('@/lib/query-client'))
        .queryCacheBuster;
    });
    jest.dontMock('expo-constants');
    return buster;
  }

  it('derives from the app version in the manifest', () => {
    expect(loadBuster({ version: '9.9.9' })).toBe('v9.9.9');
  });

  it('falls back to v0 when the manifest carries no version', () => {
    expect(loadBuster({})).toBe('v0');
    expect(loadBuster(null)).toBe('v0');
  });
});
