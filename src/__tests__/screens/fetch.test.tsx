import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Observe } from 'expo-observe';
import type { ReactElement } from 'react';

import FetchScreen from '@/app/(tabs)/(home)/fetch';
import type { Post } from '@/features/posts/api';

const posts: Post[] = [
  { userId: 1, id: 1, title: 'First post', body: 'Hello from the first post.' },
  { userId: 1, id: 2, title: 'Second post', body: 'Hello from the second post.' },
];

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const clients: QueryClient[] = [];
/** jest.setup.ts hands every `useObserve()` caller this same spy. */
const markInteractive = jest.mocked(Observe.markInteractive);

/** TanStack batches notifications on a macrotask; flush it inside act to avoid warnings. */
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderWithQuery(ui: ReactElement) {
  // gcTime: Infinity keeps the client from scheduling timers that outlive the test.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('FetchScreen', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    markInteractive.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clients.splice(0).forEach((client) => client.clear());
  });

  it('shows a loading state while the request is in flight', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    await renderWithQuery(<FetchScreen />);
    expect(screen.getByTestId('fetch-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('fetch-loading')).toBeOnTheScreen();
    expect(screen.getByText('Loading posts…')).toBeOnTheScreen();
    expect(markInteractive).not.toHaveBeenCalled();
  });

  it('marks the screen interactive once content is usable', async () => {
    // The request stays deferred so the loading-phase assertion cannot race the query
    // resolving; only the explicit resolve below moves the screen to its content state.
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await renderWithQuery(<FetchScreen />);
    expect(screen.getByTestId('fetch-loading')).toBeOnTheScreen();
    expect(markInteractive).not.toHaveBeenCalled();

    const response = await jsonResponse(posts);
    await act(async () => {
      resolveFetch(response);
    });

    expect(await screen.findByText('First post')).toBeOnTheScreen();
    expect(markInteractive).toHaveBeenCalledTimes(1);
  });

  it('marks the empty state interactive but not the error state', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('No posts yet')).toBeOnTheScreen();
    expect(markInteractive).toHaveBeenCalledTimes(1);

    markInteractive.mockClear();
    fetchMock.mockImplementation(() => jsonResponse({ message: 'nope' }, 500));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('Something went wrong')).toBeOnTheScreen();
    expect(markInteractive).not.toHaveBeenCalled();
  });

  it('renders the list on success', async () => {
    fetchMock.mockImplementation(() => jsonResponse(posts));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('First post')).toBeOnTheScreen();
    expect(screen.getByText('Second post')).toBeOnTheScreen();
    expect(screen.getByTestId('fetch-list')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('jsonplaceholder.typicode.com/posts');
  });

  it('renders the error state when the body does not match the schema', async () => {
    // `postSchema` (Zod) is the only thing standing between a changed API and `undefined.title`
    // in a render, so a well-formed 200 with the wrong shape must land in the error state.
    // Same deferred-promise pattern as above: nothing resolves until the explicit act().
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    await renderWithQuery(<FetchScreen />);
    expect(screen.getByTestId('fetch-loading')).toBeOnTheScreen();

    // `title` is a number and `body` is missing: JSON-parseable, schema-invalid.
    const response = await jsonResponse([{ userId: 1, id: 1, title: 42 }]);
    await act(async () => {
      resolveFetch(response);
    });

    expect(await screen.findByTestId('fetch-error')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('Unexpected response shape')).toBeOnTheScreen();
    expect(screen.queryByTestId('fetch-list')).not.toBeOnTheScreen();
    expect(markInteractive).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('renders the error state when the body is not an array at all', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(() => jsonResponse({ posts: [] }));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByTestId('fetch-error')).toBeOnTheScreen();
    expect(screen.getByText('Unexpected response shape')).toBeOnTheScreen();
    warn.mockRestore();
  });

  it('renders the empty state when the API returns no posts', async () => {
    fetchMock.mockImplementation(() => jsonResponse([]));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('No posts yet')).toBeOnTheScreen();
    expect(screen.queryByTestId('fetch-list')).not.toBeOnTheScreen();
  });

  it('renders the error state and retries on press', async () => {
    fetchMock
      .mockImplementationOnce(() => jsonResponse({ message: 'nope' }, 500))
      .mockImplementationOnce(() => jsonResponse(posts));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('Request failed with status 500')).toBeOnTheScreen();

    await press('fetch-retry');

    expect(await screen.findByText('First post')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches when the refetch button is pressed', async () => {
    let resolveSecond: (value: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce(() => jsonResponse(posts))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveSecond = resolve)));
    await renderWithQuery(<FetchScreen />);
    expect(await screen.findByText('First post')).toBeOnTheScreen();

    await press('fetch-refetch');

    expect(await screen.findByText('Refreshing…')).toBeOnTheScreen();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveSecond(await jsonResponse(posts));

    expect(await screen.findByText('Refetch')).toBeOnTheScreen();
    expect(screen.getByText('First post')).toBeOnTheScreen();
  });
});
