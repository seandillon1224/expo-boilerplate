import { Stack } from 'expo-router/stack';
import { useTranslation } from 'react-i18next';

export default function SettingsStackLayout() {
  const { t } = useTranslation();
  return (
    <Stack>
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
      <Stack.Screen name="updates" options={{ title: t('updates.title') }} />
    </Stack>
  );
}
