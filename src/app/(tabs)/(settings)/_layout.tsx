import { Stack } from 'expo-router/stack';

export default function SettingsStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
