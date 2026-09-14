import { render, screen } from '@testing-library/react-native';

import NotFoundScreen from '@/app/+not-found';

// @testing-library/react-native v14+: render/rerender/unmount are async.
describe('NotFoundScreen', () => {
  it('renders the empty state and a link home', async () => {
    await render(<NotFoundScreen />);
    expect(screen.getByTestId('not-found-screen')).toBeOnTheScreen();
    expect(screen.getByText('This screen does not exist')).toBeOnTheScreen();
    expect(screen.getByTestId('not-found-home-link')).toBeOnTheScreen();
  });
});
