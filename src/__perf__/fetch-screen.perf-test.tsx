import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';

import FetchScreen from '@/app/(tabs)/(home)/fetch';
import type { Post } from '@/features/posts/api';

// Seed Reassure perf test for a data-loading hot path (PLAN.md decision 7): the Fetch screen
// going loading -> list through TanStack Query, with `fetch` mocked to resolve immediately so the
// only variable is render work. Run by `bun run perf`, not `bun run test` (see home-screen).
const posts: Post[] = Array.from({ length: 20 }, (_, index) => ({
  userId: 1,
  id: index + 1,
  title: `Post ${index + 1}`,
  body: `Body of post ${index + 1}. Long enough to wrap onto a second line in the row.`,
}));

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

/** Fresh client per render so every run starts from the loading state, never from cache. */
function Subject() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return (
    <QueryClientProvider client={client}>
      <FetchScreen />
    </QueryClientProvider>
  );
}

describe('FetchScreen', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders the loading state', async () => {
    // A request that never settles keeps every run on the loading branch.
    globalThis.fetch = jest.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    await measureRenders(<Subject />, {
      scenario: async () => {
        screen.getByTestId('fetch-loading');
      },
    });
  });

  it('renders the list once posts resolve', async () => {
    globalThis.fetch = jest.fn(() => jsonResponse(posts)) as unknown as typeof fetch;
    await measureRenders(<Subject />, {
      scenario: async () => {
        // CI runners are slow under Reassure's repeated runs; RNTL's default 1 s wait timed out.
        await screen.findByTestId('fetch-list', {}, { timeout: 15_000 });
      },
    });
  });
});
