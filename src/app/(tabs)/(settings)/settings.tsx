import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { captureException } from '@/lib/sentry';
import { Link, Pressable, Text, View } from '@/tw';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [testSent, setTestSent] = useState(false);

  const sendTestError = () => {
    // Harmless when Sentry is a no-op (no DSN / dev build): nothing leaves the device.
    captureException(new Error('sentry test'), { source: 'settings-sentry-test' });
    setTestSent(true);
  };

  return (
    <View
      testID="settings-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">{t('settings.title')}</Text>
      <Text className="text-muted-foreground text-center">{t('settings.subtitle')}</Text>
      <Link
        href="/updates"
        testID="settings-updates-link"
        accessibilityRole="link"
        className="bg-muted text-foreground mt-4 rounded-md px-4 py-2 font-semibold"
      >
        {t('settings.updatesLink')}
      </Link>
      <Pressable
        testID="settings-sentry-test"
        accessibilityRole="button"
        onPress={sendTestError}
        className="bg-primary mt-4 rounded-md px-4 py-2"
      >
        <Text className="text-primary-foreground font-semibold">{t('settings.sentryTest')}</Text>
      </Pressable>
      {testSent ? (
        <Text testID="settings-sentry-test-sent" className="text-muted-foreground text-sm">
          {t('settings.sentryTestSent')}
        </Text>
      ) : null}
    </View>
  );
}
