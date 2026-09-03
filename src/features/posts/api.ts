import { useQuery } from '@tanstack/react-query';

import { env } from '@/lib/env';

/** Shape of a JSONPlaceholder post. Runtime validation with Zod arrives in a later ticket. */
export type Post = {
  userId: number;
  id: number;
  title: string;
  body: string;
};

const POSTS_URL = `${env.API_URL}/posts?_limit=10`;

/** Query-key factory: every posts-related key hangs off `postKeys.all`. */
const postKeys = {
  all: ['posts'] as const,
  list: () => [...postKeys.all, 'list'] as const,
};

async function fetchPosts(signal?: AbortSignal): Promise<Post[]> {
  const response = await fetch(POSTS_URL, { signal });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response shape');
  }
  return data as Post[];
}

export function usePosts() {
  return useQuery({
    queryKey: postKeys.list(),
    queryFn: ({ signal }) => fetchPosts(signal),
  });
}
