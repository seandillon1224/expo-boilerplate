import type { ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { captureException } from '@/lib/sentry';
import { View } from '@/tw';

/**
 * Expo Router route-level error boundary. Re-export it as `ErrorBoundary` from a route
 * or layout file and Router wraps that route in a `Try` that renders this on throw.
 * The root layout exports it so every route gets it by default; a route can export its
 * own to override.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  useEffect(() => {
    captureException(error, { source: 'route-error-boundary' });
  }, [error]);
  return (
    <View testID="route-error-boundary" className="bg-background flex-1">
      <ErrorState
        error={error}
        title={t('errorBoundary.title')}
        retryLabel={t('errorBoundary.reset')}
        retryTestID="route-error-boundary-reset"
        onRetry={() => {
          void retry();
        }}
      />
    </View>
  );
}
