import { Stack } from 'expo-router/stack';
import { useTranslation } from 'react-i18next';

export default function HomeStackLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: t('home.title') }} />
      <Stack.Screen name="fetch" options={{ title: t('fetch.title') }} />
    </Stack>
  );
}
