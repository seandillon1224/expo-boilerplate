import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { Link, View } from '@/tw';

/**
 * Catch-all for URLs Expo Router cannot match (a stale deep link, a mistyped path, a route
 * that moved). Expo Router picks `app/+not-found.tsx` up automatically — it needs no entry in
 * the root `Stack` — and the static web export writes it as `+not-found.html`, which
 * `scripts/serve-web.js` serves with a real 404 for any unresolved path.
 */
export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <View className="bg-background flex-1">
      <EmptyState
        testID="not-found-screen"
        title={t('notFound.title')}
        description={t('notFound.description')}
      />
      {/* A Link rather than EmptyState's `action`: going home is navigation, not a callback,
          so it stays a real anchor on web (right-click, middle-click, crawlable). */}
      <View className="items-center px-6 pb-12">
        <Link
          href="/"
          testID="not-found-home-link"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 font-semibold"
        >
          {t('notFound.home')}
        </Link>
      </View>
    </View>
  );
}
