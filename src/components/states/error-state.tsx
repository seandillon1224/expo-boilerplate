import { useTranslation } from 'react-i18next';

import { Pressable, Text, View } from '@/tw';

export type ErrorStateProps = {
  /** Used to derive the description when none is given (`Error.message` or a string). */
  error?: unknown;
  /** Defaults to `states.errorTitle`. */
  title?: string;
  /** Overrides the message derived from `error`; falls back to `states.errorDescription`. */
  description?: string;
  /** When set, renders a retry button. */
  onRetry?: () => void;
  /** Defaults to `states.retry`. */
  retryLabel?: string;
  retryTestID?: string;
  testID?: string;
};

/** Best-effort human-readable message from whatever was thrown. */
function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (typeof error === 'string') return error || undefined;
  return undefined;
}

/** Centered failure message with an optional retry action. */
export function ErrorState({
  error,
  title,
  description,
  onRetry,
  retryLabel,
  retryTestID = 'error-state-retry',
  testID = 'error-state',
}: ErrorStateProps) {
  const { t } = useTranslation();
  const message = description ?? getErrorMessage(error) ?? t('states.errorDescription');
  return (
    <View testID={testID} className="flex-1 items-center justify-center gap-3 px-6">
      <Text className="text-foreground text-center font-semibold">
        {title ?? t('states.errorTitle')}
      </Text>
      <Text className="text-muted-foreground text-center">{message}</Text>
      {onRetry ? (
        <Pressable
          testID={retryTestID}
          accessibilityRole="button"
          onPress={onRetry}
          className="bg-primary rounded-md px-4 py-2"
        >
          <Text className="text-primary-foreground font-semibold">
            {retryLabel ?? t('states.retry')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
