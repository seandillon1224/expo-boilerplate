/* eslint-disable @typescript-eslint/no-require-imports -- repo-file assertions; no @types/node */
const fs = require('node:fs');
const path = require('node:path');

/**
 * `AGENTS.md` tells every agent to read the docs for the pinned SDK, and it carries the URL as a
 * literal — a formula ("derive it from package.json") would have to be evaluated by whoever is
 * reading, and AGENTS.md is read as static text. So the literal stays and this test keeps it
 * honest: the major in every `docs.expo.dev/versions/vNN…` URL in the repo's markdown must match
 * the `expo` major in package.json. An SDK upgrade that forgets the URL fails the gate.
 */
const ROOT = process.cwd();

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** `~57.0.19` / `^57.0.0` / `57.0.0` → `57`. */
function expoMajor(): string {
  const range = JSON.parse(read('package.json')).dependencies.expo as string;
  const major = range.match(/(\d+)\./);
  if (!major) throw new Error(`package.json: cannot read a major from expo "${range}"`);
  return major[1];
}

/** Markdown files that may carry a versioned Expo docs URL (excludes generated / vendored trees). */
const MARKDOWN = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  ...fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => `docs/${f}`),
];

const VERSIONED_URL = /docs\.expo\.dev\/versions\/v(\d+)\.\d+\.\d+/g;

describe('versioned Expo docs URLs', () => {
  const major = expoMajor();

  it('AGENTS.md points at the pinned SDK', () => {
    const urls = [...read('AGENTS.md').matchAll(VERSIONED_URL)];
    expect(urls).toHaveLength(1);
    expect(urls[0][1]).toBe(major);
  });

  it.each(MARKDOWN)('%s uses the pinned SDK major in every versioned docs URL', (file: string) => {
    const majors = [...read(file).matchAll(VERSIONED_URL)].map((m: string[]) => m[1]);
    expect(majors.filter((m: string) => m !== major)).toEqual([]);
  });
});
