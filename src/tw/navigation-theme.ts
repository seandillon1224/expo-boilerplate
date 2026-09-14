import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import type { ColorSchemeName } from 'react-native';

import { colorTokens } from './tokens';

/**
 * React Navigation's theme, built from the same tokens the screens paint with
 * (`src/tw/tokens.ts`, mirrored into `src/global.css`). Without this, navigation chrome
 * uses React Navigation's stock palette — a grey background and a blue tint that disagree
 * with the app's own colours, most visibly in light mode.
 *
 * Only `colors` is ours: `fonts` is spread from the stock theme so navigation keeps the
 * platform's own type scale, which is not a token this app owns.
 */
export function navigationTheme(colorScheme: ColorSchemeName): Theme {
  const dark = colorScheme === 'dark';
  const palette = dark ? colorTokens.dark : colorTokens.light;
  return {
    ...(dark ? DarkTheme : DefaultTheme),
    dark,
    colors: {
      primary: palette.primary,
      background: palette.background,
      card: palette.card,
      text: palette.foreground,
      border: palette.border,
      notification: palette.notification,
    },
  };
}
