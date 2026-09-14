import { DefaultTheme } from 'expo-router';

import { navigationTheme } from '@/tw/navigation-theme';
import { colorTokens } from '@/tw/tokens';

describe('navigationTheme', () => {
  it.each([
    ['light', 'light', colorTokens.light, false],
    ['dark', 'dark', colorTokens.dark, true],
    // `useColorScheme()` reports 'unspecified' when the system preference is unknown.
    ['unspecified', 'unspecified', colorTokens.light, false],
  ] as const)('derives %s colours from the tokens', (_label, scheme, palette, dark) => {
    const theme = navigationTheme(scheme);
    expect(theme.dark).toBe(dark);
    expect(theme.colors).toEqual({
      primary: palette.primary,
      background: palette.background,
      card: palette.card,
      text: palette.foreground,
      border: palette.border,
      notification: palette.notification,
    });
  });

  it('keeps the stock navigation font scale', () => {
    expect(navigationTheme('light').fonts).toBe(DefaultTheme.fonts);
  });

  it('does not use React Navigation stock colours', () => {
    expect(navigationTheme('light').colors).not.toEqual(DefaultTheme.colors);
  });
});
