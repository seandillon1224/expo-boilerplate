import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/session/use-session';
import { env } from '@/lib/env';
import { captureException } from '@/lib/sentry';
import { Link, Pressable, Text, View } from '@/tw';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [testSent, setTestSent] = useState(false);
  // Demo session (T13.6): flipping this to false sends the router back to `(auth)/sign-in`,
  // because `(tabs)` sits behind `<Stack.Protected>` in the root layout.
  const { signOut } = useSession();
  // Diagnostics only: never ship a button that fires a real error into the production issue stream.
  const showSentryTest = env.APP_VARIANT !== 'production';

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
        className="bg-muted text-foreground mt-4 rounded-md px-4 py-2 font-semibold"
      >
        {t('settings.updatesLink')}
      </Link>
      <Pressable
        testID="settings-sign-out"
        accessibilityRole="button"
        onPress={signOut}
        className="bg-muted mt-4 rounded-md px-4 py-2"
      >
        <Text className="text-foreground font-semibold">{t('settings.signOut')}</Text>
      </Pressable>
      {showSentryTest ? (
        <Pressable
          testID="settings-sentry-test"
          accessibilityRole="button"
          onPress={sendTestError}
          className="bg-primary mt-4 rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">{t('settings.sentryTest')}</Text>
        </Pressable>
      ) : null}
      {showSentryTest && testSent ? (
        <Text testID="settings-sentry-test-sent" className="text-muted-foreground text-sm">
          {t('settings.sentryTestSent')}
        </Text>
      ) : null}
    </View>
  );
}
