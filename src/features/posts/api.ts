import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { env } from '@/lib/env';

/**
 * Runtime shape of a JSONPlaceholder post. The network is not typed, so the response is parsed
 * rather than cast: a malformed body fails here (and lands in the screen's `ErrorState`) instead
 * of surfacing as `undefined.title` deep inside a render.
 */
const postSchema = z.object({
  userId: z.number(),
  id: z.number(),
  title: z.string(),
  body: z.string(),
});

export type Post = z.infer<typeof postSchema>;

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
  // safeParse, not parse: a raw ZodError's `message` is a JSON blob, and `ErrorState` prints
  // `error.message` straight to the user. The issues still reach the console for debugging.
  const parsed = postSchema.array().safeParse(data);
  if (!parsed.success) {
    console.warn('posts: unexpected response shape\n', z.prettifyError(parsed.error));
    throw new Error('Unexpected response shape');
  }
  return parsed.data;
}

export function usePosts() {
  return useQuery({
    queryKey: postKeys.list(),
    queryFn: ({ signal }) => fetchPosts(signal),
  });
}
