import '@/global.css';
// Registers i18next with react-i18next before any screen calls useTranslation().
import '@/i18n';

import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { UpdateBanner } from '@/features/updates/update-banner';
import { useUpdatePolicyDriver } from '@/features/updates/use-update-policy';
import { useDevTools } from '@/lib/devtools';
import { assertEnv } from '@/lib/env';
import { configureObserve, wrapObserveRoot } from '@/lib/observe';
import { queryClient } from '@/lib/query-client';
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

// Expo Router holds the native splash itself (an internal prevent-auto-hide) and hides it once
// the navigator is ready, so we never call preventAutoHideAsync/hideAsync here — doing so would
// opt out of that and leave the splash up forever. We only configure how it goes away:
// a 600ms cross-fade instead of a hard cut (`fade` is iOS-only; Android ignores it).
SplashScreen.setOptions({ fade: true, duration: 600 });

function RootLayout() {
  const colorScheme = useColorScheme();
  // Rozenite DevTools plugins (Query / network / performance); no-op outside dev.
  useDevTools(queryClient);
  // OTA policy (ADR-0003): check on launch / foreground, idle-resume reload; no state, one effect.
  useUpdatePolicyDriver();
  return (
    <QueryProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
        {/* Overlays the navigator; renders only for `opt-in` with a downloaded update waiting. */}
        <UpdateBanner />
      </ThemeProvider>
    </QueryProvider>
  );
}

// Sentry outermost (error boundary / touch instrumentation around everything); Observe
// inside it so first-render timing covers the app tree and screens see its provider.
export default wrapRoot(wrapObserveRoot(RootLayout));
