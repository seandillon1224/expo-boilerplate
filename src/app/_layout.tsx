import '@/global.css';
// Registers i18next with react-i18next before any screen calls useTranslation().
import '@/i18n';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { assertEnv } from '@/lib/env';
import { configureObserve, wrapObserveRoot } from '@/lib/observe';
import { initSentry, wrapRoot } from '@/lib/sentry';
import { QueryProvider } from '@/providers/query-provider';

// Router renders this for any route that throws during render (routes may override).
export { RouteErrorBoundary as ErrorBoundary } from '@/components/route-error-boundary';

// Surface EXPO_PUBLIC_* misconfiguration before any screen mounts.
assertEnv();
// No-op unless EXPO_PUBLIC_SENTRY_DSN is set; must run before the first render.
initSentry();
// Dispatches only with `extra.eas.projectId` set; enables per-route Expo Router metrics.
configureObserve();

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

// Sentry outermost (error boundary / touch instrumentation around everything); Observe
// inside it so first-render timing covers the app tree and screens see its provider.
export default wrapRoot(wrapObserveRoot(RootLayout));
