import { ActivityIndicator, FlatList } from 'react-native';

import { type Post, usePosts } from '@/features/posts/api';
import { Pressable, Text, View } from '@/tw';

function PostRow({ post }: { post: Post }) {
  return (
    <View testID={`fetch-post-${post.id}`} className="border-border gap-1 border-b py-3">
      <Text className="text-foreground font-semibold">{post.title}</Text>
      <Text className="text-muted-foreground" numberOfLines={2}>
        {post.body}
      </Text>
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center gap-3 px-6">{children}</View>;
}

export default function FetchScreen() {
  const { data, isPending, isError, error, refetch, isFetching } = usePosts();

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <Centered>
        <ActivityIndicator testID="fetch-loading" />
        <Text className="text-muted-foreground">Loading posts…</Text>
      </Centered>
    );
  } else if (isError) {
    content = (
      <Centered>
        <Text className="text-foreground text-center font-semibold">Something went wrong</Text>
        <Text className="text-muted-foreground text-center">{error.message}</Text>
        <Pressable
          testID="fetch-retry"
          accessibilityRole="button"
          onPress={() => refetch()}
          className="bg-primary rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">Retry</Text>
        </Pressable>
      </Centered>
    );
  } else if (data.length === 0) {
    content = (
      <Centered>
        <Text className="text-foreground font-semibold">No posts yet</Text>
        <Text className="text-muted-foreground text-center">The API returned an empty list.</Text>
      </Centered>
    );
  } else {
    content = (
      <FlatList
        testID="fetch-list"
        data={data}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PostRow post={item} />}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      />
    );
  }

  return (
    <View testID="fetch-screen" className="bg-background flex-1">
      <View className="border-border flex-row items-center justify-between border-b px-4 py-2">
        <Text className="text-muted-foreground">jsonplaceholder.typicode.com/posts</Text>
        <Pressable
          testID="fetch-refetch"
          accessibilityRole="button"
          disabled={isFetching}
          onPress={() => refetch()}
          className="bg-muted rounded-md px-3 py-1"
        >
          <Text className="text-foreground">{isFetching ? 'Refreshing…' : 'Refetch'}</Text>
        </Pressable>
      </View>
      {content}
    </View>
  );
}
