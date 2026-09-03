import { render, screen } from '@testing-library/react-native';

import { cn, Text, View } from '@/tw';

// @testing-library/react-native v14+: render/rerender/unmount are async.
describe('@/tw', () => {
  it('renders className-styled primitives', async () => {
    await render(
      <View testID="box" className="bg-background flex-1">
        <Text className="text-foreground">styled</Text>
      </View>,
    );
    expect(screen.getByTestId('box')).toBeOnTheScreen();
    expect(screen.getByText('styled')).toBeOnTheScreen();
  });

  it('cn merges conflicting tailwind classes', () => {
    expect(cn('p-2', 'p-4', { hidden: false, flex: true })).toBe('p-4 flex');
  });
});
