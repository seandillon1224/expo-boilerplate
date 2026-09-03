import { useTranslation } from 'react-i18next';

import { Text, View } from '@/tw';

export default function SettingsScreen() {
  const { t } = useTranslation();
  return (
    <View
      testID="settings-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">{t('settings.title')}</Text>
      <Text className="text-muted-foreground text-center">{t('settings.subtitle')}</Text>
    </View>
  );
}
