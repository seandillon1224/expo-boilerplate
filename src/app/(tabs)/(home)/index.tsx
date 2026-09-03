import { useTranslation } from 'react-i18next';

import { Link, Text, View } from '@/tw';

export default function HomeScreen() {
  const { t } = useTranslation();
  return (
    <View
      testID="home-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">{t('home.title')}</Text>
      <Text className="text-muted-foreground text-center">{t('home.subtitle')}</Text>
      <Link
        href="/fetch"
        testID="home-fetch-link"
        className="bg-primary text-primary-foreground mt-4 rounded-md px-4 py-2 font-semibold"
      >
        {t('home.fetchLink')}
      </Link>
    </View>
  );
}
