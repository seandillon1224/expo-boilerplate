/**
 * className-enabled primitives. react-native-css needs each element wrapped with
 * `useCssElement`, so import View/Text/etc. from `@/tw` instead of `react-native`
 * whenever you want Tailwind classes.
 */
import { Link as RouterLink } from 'expo-router';
import type { ComponentProps, ComponentType } from 'react';
import {
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View as RNView,
} from 'react-native';
import { type StyledConfiguration, useCssElement, useNativeVariable } from 'react-native-css';

export { cn } from './cn';

type WithClassName<P> = P & { className?: string };

// react-native's prop types are too large for TS to derive `StyledConfiguration<C>`
// per component (TS2590), so the mappings are typed against a loose component and
// each wrapper casts its primitive to that shape.
type Styleable = ComponentType<{ style?: unknown; contentContainerStyle?: unknown }>;
const styleMapping: StyledConfiguration<Styleable> = { className: 'style' };
const scrollViewMapping: StyledConfiguration<Styleable> = {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
};

export type ViewProps = WithClassName<ComponentProps<typeof RNView>>;
export function View(props: ViewProps) {
  return useCssElement(RNView as unknown as Styleable, props, styleMapping);
}
View.displayName = 'CSS(View)';

export type TextProps = WithClassName<ComponentProps<typeof RNText>>;
export function Text(props: TextProps) {
  return useCssElement(RNText as unknown as Styleable, props, styleMapping);
}
Text.displayName = 'CSS(Text)';

export type PressableProps = WithClassName<ComponentProps<typeof RNPressable>>;
export function Pressable(props: PressableProps) {
  return useCssElement(RNPressable as unknown as Styleable, props, styleMapping);
}
Pressable.displayName = 'CSS(Pressable)';

export type TextInputProps = WithClassName<ComponentProps<typeof RNTextInput>>;
export function TextInput(props: TextInputProps) {
  return useCssElement(RNTextInput as unknown as Styleable, props, styleMapping);
}
TextInput.displayName = 'CSS(TextInput)';

export type ScrollViewProps = WithClassName<ComponentProps<typeof RNScrollView>> & {
  contentContainerClassName?: string;
};
export function ScrollView(props: ScrollViewProps) {
  return useCssElement(RNScrollView as unknown as Styleable, props, scrollViewMapping);
}
ScrollView.displayName = 'CSS(ScrollView)';

export type LinkProps = WithClassName<ComponentProps<typeof RouterLink>>;
export function Link(props: LinkProps) {
  return useCssElement(RouterLink as unknown as Styleable, props, styleMapping);
}
Link.displayName = 'CSS(Link)';
Link.Trigger = RouterLink.Trigger;
Link.Menu = RouterLink.Menu;
Link.MenuAction = RouterLink.MenuAction;
Link.Preview = RouterLink.Preview;

/**
 * Read a CSS variable (e.g. `--primary`) from JS. On native it resolves through
 * the react-native-css runtime; on web it returns a `var()` reference for the browser.
 */
export const useCSSVariable =
  process.env.EXPO_OS === 'web' ? (variable: string) => `var(${variable})` : useNativeVariable;
