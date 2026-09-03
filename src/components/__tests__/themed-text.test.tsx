import { render, screen } from '@testing-library/react-native';

import { ThemedText } from '@/components/themed-text';

// @testing-library/react-native v14+: render/rerender/unmount are async.
describe('ThemedText', () => {
  it('renders its children', async () => {
    await render(<ThemedText>hello</ThemedText>);
    expect(screen.getByText('hello')).toBeOnTheScreen();
  });
});
