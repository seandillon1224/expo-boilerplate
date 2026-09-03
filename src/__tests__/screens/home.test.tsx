import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/(tabs)/(home)/index';

// @testing-library/react-native v14+: render/rerender/unmount are async.
describe('HomeScreen', () => {
  it('renders the home screen container', async () => {
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.getByText('Home')).toBeOnTheScreen();
  });
});
