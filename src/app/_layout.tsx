import '@/global.css';
// Registers i18next with react-i18next before any screen calls useTranslation().
import '@/i18n';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { assertEnv } from '@/lib/env';
import { initSentry, wrapRoot } from '@/lib/sentry';
import { QueryProvider } from '@/providers/query-provider';

// Surface EXPO_PUBLIC_* misconfiguration before any screen mounts.
assertEnv();
// No-op unless EXPO_PUBLIC_SENTRY_DSN is set; must run before the first render.
initSentry();

SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </ThemeProvider>
    </QueryProvider>
  );
}

export default wrapRoot(RootLayout);
