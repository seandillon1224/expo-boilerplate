import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ErrorBoundary } from '@/components/error-boundary';
import { RouteErrorBoundary } from '@/components/route-error-boundary';
import { Text } from '@/tw';

const captureException = jest.mocked(Sentry.captureException);

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('kaboom');
  return <Text>Recovered</Text>;
}

describe('ErrorBoundary', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    // React logs caught render errors; they are expected here.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    captureException.mockClear();
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders children when nothing throws', async () => {
    await render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Recovered')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-boundary')).not.toBeOnTheScreen();
  });

  it('catches a throwing child, reports to Sentry and renders the default fallback', async () => {
    const onError = jest.fn();
    await render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('kaboom')).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toEqual(
      expect.objectContaining({ message: 'kaboom' }),
    );
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('renders a custom fallback', async () => {
    await render(
      <ErrorBoundary fallback={({ error }) => <Text>custom: {error.message}</Text>}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText('custom: kaboom')).toBeOnTheScreen();
  });

  it('reset button re-renders children once they no longer throw', async () => {
    let shouldThrow = true;
    function Toggle() {
      return <Bomb shouldThrow={shouldThrow} />;
    }
    await render(
      <ErrorBoundary>
        <Toggle />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary')).toBeOnTheScreen();

    shouldThrow = false;
    await act(async () => {
      fireEvent.press(screen.getByTestId('error-boundary-reset'));
    });
    expect(screen.getByText('Recovered')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-boundary')).not.toBeOnTheScreen();
  });
});

describe('RouteErrorBoundary', () => {
  beforeEach(() => captureException.mockClear());

  it('renders the error, reports it, and wires retry to the button', async () => {
    const retry = jest.fn(async () => {});
    await render(<RouteErrorBoundary error={new Error('route exploded')} retry={retry} />);
    expect(screen.getByTestId('route-error-boundary')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('route exploded')).toBeOnTheScreen();
    expect(captureException).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('route-error-boundary-reset'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
