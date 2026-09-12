import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useUpdatePolicy } from '@/features/updates/use-update-policy';
import { Pressable, Text, View } from '@/tw';

/**
 * Non-blocking "update ready" banner for the `opt-in` policy (ADR-0003). Overlays the top of the
 * screen from the root layout; renders nothing for every other policy or while no downloaded
 * update is waiting. "Later" hides it until the next downloaded update (the idle-resume reload
 * still applies).
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { policy, isUpdateReady, restartNow, dismiss } = useUpdatePolicy();
  const insets = useSafeAreaInsets();

  if (policy !== 'opt-in' || !isUpdateReady) return null;

  return (
    <View
      testID="update-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="bg-primary absolute inset-x-0 top-0 z-50 gap-3 px-4 pb-3 shadow-sm"
      style={{ paddingTop: insets.top + 12 }}
    >
      <View className="gap-0.5">
        <Text className="text-primary-foreground font-semibold">{t('updates.banner.title')}</Text>
        <Text className="text-primary-foreground text-sm opacity-90">
          {t('updates.banner.description')}
        </Text>
      </View>
      <View className="flex-row justify-end gap-3">
        <Pressable
          testID="update-banner-later"
          accessibilityRole="button"
          onPress={dismiss}
          className="rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">{t('updates.banner.later')}</Text>
        </Pressable>
        <Pressable
          testID="update-banner-restart"
          accessibilityRole="button"
          onPress={restartNow}
          className="bg-primary-foreground rounded-md px-4 py-2"
        >
          <Text className="text-primary font-semibold">{t('updates.banner.restart')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
