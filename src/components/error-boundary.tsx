import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { captureException } from '@/lib/sentry';

type ErrorBoundaryFallbackProps = {
  error: Error;
  /** Clears the error and re-renders `children`. */
  reset: () => void;
};

export type ErrorBoundaryProps = {
  children: ReactNode;
  /** Custom fallback; defaults to `ErrorState` with a "Try again" reset button. */
  fallback?: (props: ErrorBoundaryFallbackProps) => ReactNode;
  /** Called after the error is reported to Sentry. */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = { error: Error | null };

function DefaultFallback({ error, reset }: ErrorBoundaryFallbackProps) {
  const { t } = useTranslation();
  return (
    <ErrorState
      testID="error-boundary"
      retryTestID="error-boundary-reset"
      error={error}
      title={t('errorBoundary.title')}
      retryLabel={t('errorBoundary.reset')}
      onRetry={reset}
    />
  );
}

/**
 * Catches render errors in a subtree, reports them to Sentry, and shows a recoverable
 * fallback. Route-level errors are handled by Expo Router via `route-error-boundary.tsx`;
 * use this around widgets/sections that should fail independently of the screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    if (fallback) return fallback({ error, reset: this.reset });
    return <DefaultFallback error={error} reset={this.reset} />;
  }
}
