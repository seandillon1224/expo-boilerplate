import { Link, Text, View } from '@/tw';

export default function HomeScreen() {
  return (
    <View
      testID="home-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">Home</Text>
      <Text className="text-muted-foreground text-center">
        Opinionated infra, thin product. Start building in src/app/(tabs)/(home).
      </Text>
      <Link
        href="/fetch"
        testID="home-fetch-link"
        className="bg-primary text-primary-foreground mt-4 rounded-md px-4 py-2 font-semibold"
      >
        Open fetch demo
      </Link>
    </View>
  );
}
