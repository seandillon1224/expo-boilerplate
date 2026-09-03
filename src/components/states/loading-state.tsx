import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from 'react-native';

import { Text, View } from '@/tw';

export type LoadingStateProps = {
  /** Defaults to `states.loading`. */
  label?: string;
  testID?: string;
};

/** Centered spinner + label for a screen or section whose data is still in flight. */
export function LoadingState({ label, testID = 'loading-state' }: LoadingStateProps) {
  const { t } = useTranslation();
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 px-6">
      <ActivityIndicator />
      <Text className="text-muted-foreground text-center">{label ?? t('states.loading')}</Text>
    </View>
  );
}
