import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { colorTokens } from '@/tw/tokens';

/**
 * Drift guard for the hand-written CSS mirror of src/tw/tokens.ts. The tokens are the
 * source of truth; global.css has to repeat them so Tailwind can compile classes from
 * them. This test parses the CSS and fails if a value, a key or a `@theme inline`
 * registration disagrees with the TS.
 */
// Comments are stripped first: they talk *about* `:root` and `@theme inline`, and the
// block finder would otherwise anchor on the prose.
const css = readFileSync(join(__dirname, '../../global.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The `{ ... }` body of the first block whose header matches `pattern`, brace-matched. */
function blockBody(source: string, pattern: RegExp): string {
  const match = pattern.exec(source);
  if (!match) throw new Error(`global.css: no block header matching ${pattern}`);
  const open = source.indexOf('{', match.index);
  if (open === -1) throw new Error(`global.css: block ${pattern} has no opening brace`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`global.css: block ${pattern} is never closed`);
}

/** `--name: value;` declarations of a block, as a plain object. */
function declarations(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

/** `{ background: '#fff' }` -> `{ '--background': '#fff' }`. */
function asCustomProperties(palette: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(palette).map(([name, value]) => [`--${name}`, value]));
}

// Only the light palette sits at column 0; the dark one is nested in the media query and
// the web font stacks in an @supports block, so neither is matched by the `^` anchor.
const lightBlock = declarations(blockBody(css, /^:root\s*\{/m));
const darkBlock = declarations(
  blockBody(blockBody(css, /@media \(prefers-color-scheme: dark\)/), /:root\s*\{/),
);
const themeBlock = declarations(blockBody(css, /@theme inline/));

describe('colour tokens', () => {
  it('global.css :root matches the light palette exactly', () => {
    expect(lightBlock).toEqual(asCustomProperties(colorTokens.light));
  });

  it('global.css prefers-color-scheme: dark matches the dark palette exactly', () => {
    expect(darkBlock).toEqual(asCustomProperties(colorTokens.dark));
  });

  it('every token is registered as a Tailwind colour, and nothing else is', () => {
    const expected = Object.fromEntries(
      Object.keys(colorTokens.light).map((name) => [`--color-${name}`, `var(--${name})`]),
    );
    expect(themeBlock).toEqual(expected);
  });

  it('light and dark define the same token names', () => {
    expect(Object.keys(colorTokens.dark)).toEqual(Object.keys(colorTokens.light));
  });
});
