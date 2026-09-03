import { Stack } from 'expo-router/stack';

export default function HomeStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Home' }} />
      <Stack.Screen name="fetch" options={{ title: 'Fetch' }} />
    </Stack>
  );
}
