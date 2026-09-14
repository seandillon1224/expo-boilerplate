import { useTranslation } from 'react-i18next';

import { useSession } from '@/features/session/use-session';
import { Pressable, Text, View } from '@/tw';

/**
 * Demo sign-in screen (T13.6). The only route outside the `(tabs)` guard, so it is what the
 * router falls back to whenever `isSignedIn` is false — see `src/app/_layout.tsx` and the
 * removal instructions at the top of `src/features/session/use-session.ts`.
 *
 * There is no form on purpose: a username/password box would imply a backend the template does
 * not have. Replace the button with your provider's flow and keep calling `signIn()` when it
 * succeeds.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  return (
    <View
      testID="sign-in-screen"
      className="bg-background flex-1 items-center justify-center gap-2 px-6"
    >
      <Text className="text-foreground text-2xl font-semibold">{t('signIn.title')}</Text>
      <Text className="text-muted-foreground text-center">{t('signIn.subtitle')}</Text>
      <Pressable
        testID="sign-in-submit"
        accessibilityRole="button"
        onPress={signIn}
        className="bg-primary mt-4 rounded-md px-4 py-2"
      >
        <Text className="text-primary-foreground font-semibold">{t('signIn.action')}</Text>
      </Pressable>
    </View>
  );
}
