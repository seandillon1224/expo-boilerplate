import { useObserve } from 'expo-observe';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch, isFetching } = usePosts();
  const { markInteractive } = useObserve();

  // TTI: the screen is usable once content (or the empty state) is on screen, not while
  // loading or in error. Only the first call per screen visit is recorded.
  const isInteractive = !isPending && !isError;
  useEffect(() => {
    if (isInteractive) markInteractive();
  }, [isInteractive, markInteractive]);

  let content: React.ReactNode;
  if (isPending) {
    content = (
      <Centered>
        <ActivityIndicator testID="fetch-loading" />
        <Text className="text-muted-foreground">{t('fetch.loading')}</Text>
      </Centered>
    );
  } else if (isError) {
    content = (
      <Centered>
        <Text className="text-foreground text-center font-semibold">{t('fetch.errorTitle')}</Text>
        <Text className="text-muted-foreground text-center">{error.message}</Text>
        <Pressable
          testID="fetch-retry"
          accessibilityRole="button"
          onPress={() => refetch()}
          className="bg-primary rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">{t('fetch.retry')}</Text>
        </Pressable>
      </Centered>
    );
  } else if (data.length === 0) {
    content = (
      <Centered>
        <Text className="text-foreground font-semibold">{t('fetch.emptyTitle')}</Text>
        <Text className="text-muted-foreground text-center">{t('fetch.emptyBody')}</Text>
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
        <Text className="text-muted-foreground">{t('fetch.source')}</Text>
        <Pressable
          testID="fetch-refetch"
          accessibilityRole="button"
          disabled={isFetching}
          onPress={() => refetch()}
          className="bg-muted rounded-md px-3 py-1"
        >
          <Text className="text-foreground">
            {isFetching ? t('fetch.refreshing') : t('fetch.refetch')}
          </Text>
        </Pressable>
      </View>
      {content}
    </View>
  );
}
