/**
 * Colour tokens — the single source of truth for app colour.
 *
 * Two consumers read the same values:
 *
 * - `src/global.css` mirrors every token as a CSS custom property (`:root` for light, the
 *   `prefers-color-scheme: dark` media query for dark) and registers it in `@theme inline`,
 *   which is what turns it into a Tailwind class (`bg-background`, `text-foreground`, ...).
 * - `navigationTheme()` (`src/tw/navigation-theme.ts`) maps them onto React Navigation's
 *   `Theme`, so headers, tab bars and screen backgrounds match what the screens paint.
 *
 * The CSS mirror is hand-written, not generated: `src/tw/__tests__/tokens.test.ts` parses
 * `global.css` and fails if any value, key or `@theme inline` registration drifts from this
 * file. Adding a token is three edits — here, the two `:root` blocks, the `@theme inline`
 * block — and the test says exactly which one you forgot.
 */
export const colorTokens = {
  light: {
    background: '#ffffff',
    foreground: '#000000',
    /** Raised surfaces: navigation headers and tab bars. Flat on white by design. */
    card: '#ffffff',
    muted: '#f0f0f3',
    'muted-foreground': '#60646c',
    primary: '#3c87f7',
    'primary-foreground': '#ffffff',
    border: '#e0e1e6',
    /** Badges and destructive accents; React Navigation's `notification` colour. */
    notification: '#ff3b30',
  },
  dark: {
    background: '#000000',
    foreground: '#ffffff',
    card: '#121212',
    muted: '#212225',
    'muted-foreground': '#b0b4ba',
    primary: '#3c87f7',
    'primary-foreground': '#ffffff',
    border: '#2e3135',
    notification: '#ff453a',
  },
} as const;
