import { fireEvent, render, screen } from '@testing-library/react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';

describe('LoadingState', () => {
  it('renders the default label and testID', async () => {
    await render(<LoadingState />);
    expect(screen.getByTestId('loading-state')).toBeOnTheScreen();
    expect(screen.getByText('Loading…')).toBeOnTheScreen();
  });

  it('accepts a custom label and testID', async () => {
    await render(<LoadingState label="Loading posts…" testID="fetch-loading" />);
    expect(screen.getByTestId('fetch-loading')).toBeOnTheScreen();
    expect(screen.getByText('Loading posts…')).toBeOnTheScreen();
  });
});

describe('EmptyState', () => {
  it('renders the default title without a description or action', async () => {
    await render(<EmptyState />);
    expect(screen.getByTestId('empty-state')).toBeOnTheScreen();
    expect(screen.getByText('Nothing here yet')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('renders custom copy and an action that fires onPress', async () => {
    const onPress = jest.fn();
    await render(
      <EmptyState
        testID="posts-empty"
        title="No posts yet"
        description="The API returned an empty list."
        action={{ label: 'Create one', onPress, testID: 'posts-create' }}
      />,
    );
    expect(screen.getByTestId('posts-empty')).toBeOnTheScreen();
    expect(screen.getByText('No posts yet')).toBeOnTheScreen();
    expect(screen.getByText('The API returned an empty list.')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('posts-create'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorState', () => {
  it('renders default copy and no retry button', async () => {
    await render(<ErrorState />);
    expect(screen.getByTestId('error-state')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    expect(screen.getByText('Please try again.')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-state-retry')).not.toBeOnTheScreen();
  });

  it('derives the description from an Error or a string', async () => {
    const { rerender } = await render(<ErrorState error={new Error('Request failed')} />);
    expect(screen.getByText('Request failed')).toBeOnTheScreen();
    await rerender(<ErrorState error="Network down" />);
    expect(screen.getByText('Network down')).toBeOnTheScreen();
    await rerender(<ErrorState error={{ code: 500 }} />);
    expect(screen.getByText('Please try again.')).toBeOnTheScreen();
  });

  it('prefers explicit title/description and renders retry only with onRetry', async () => {
    const onRetry = jest.fn();
    await render(
      <ErrorState
        testID="posts-error"
        retryTestID="posts-retry"
        error={new Error('ignored')}
        title="Could not load posts"
        description="Custom description"
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('posts-error')).toBeOnTheScreen();
    expect(screen.getByText('Could not load posts')).toBeOnTheScreen();
    expect(screen.getByText('Custom description')).toBeOnTheScreen();
    expect(screen.queryByText('ignored')).not.toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('posts-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });
});
