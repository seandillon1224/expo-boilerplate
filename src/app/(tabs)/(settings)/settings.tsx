import { Text, View } from '@/tw';

export default function SettingsScreen() {
  return (
    <View
      testID="settings-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">Settings</Text>
      <Text className="text-muted-foreground text-center">
        App preferences and diagnostics will live here.
      </Text>
    </View>
  );
}
