import { useTranslation } from 'react-i18next';

import { Pressable, Text, View } from '@/tw';

export type EmptyStateProps = {
  /** Defaults to `states.emptyTitle`. */
  title?: string;
  description?: string;
  /** Optional call to action; `testID` is required so Maestro flows never select by text. */
  action?: { label: string; onPress: () => void; testID: string };
  testID?: string;
};

/** Centered "nothing here" placeholder for a list or screen with no content. */
export function EmptyState({
  title,
  description,
  action,
  testID = 'empty-state',
}: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-foreground text-center font-semibold">
        {title ?? t('states.emptyTitle')}
      </Text>
      {description ? (
        <Text className="text-muted-foreground text-center">{description}</Text>
      ) : null}
      {action ? (
        <Pressable
          testID={action.testID}
          accessibilityRole="button"
          onPress={action.onPress}
          className="bg-primary rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
