/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveFile, resolveFixture } = require('../serve-web');

/**
 * `resolveFile` is the whole security surface of `bun run serve:web`: it turns an attacker-controlled
 * request path into a filename the server reads and returns. Everything below is a way out of the
 * export directory — `..`, percent-encoded `..`, an absolute path, a sibling directory whose name
 * merely starts with the export's — plus the resolution order Maestro's web flows depend on.
 */

let dist: string;
let outside: string;
let fixtures: string;

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-web-'));
  dist = path.join(tmp, 'dist-web');
  outside = path.join(tmp, 'secret.txt');
  fixtures = path.join(tmp, 'fixtures');
  // A sibling whose path is a string-prefix of `dist`: the guard must compare path *segments*.
  const sibling = path.join(tmp, 'dist-web-evil');

  fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'nested'), { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>index</html>');
  fs.writeFileSync(path.join(dist, 'fetch.html'), '<html>fetch</html>');
  fs.writeFileSync(path.join(dist, 'favicon.ico'), 'icon');
  fs.writeFileSync(path.join(dist, 'nested', 'index.html'), '<html>nested</html>');
  fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry.js'), 'console.log(1)');
  fs.writeFileSync(outside, 'AWS_SECRET_ACCESS_KEY=hunter2');
  fs.writeFileSync(path.join(sibling, 'index.html'), '<html>evil</html>');
  fs.mkdirSync(path.join(fixtures, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(fixtures, 'posts.json'), '[]');
  fs.writeFileSync(path.join(fixtures, 'nested', 'deep.json'), '[]');
  // A sibling of the fixture dir whose name is a string-prefix of it, same trap as dist-web-evil.
  fs.mkdirSync(path.join(tmp, 'fixtures-evil'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'fixtures-evil', 'posts.json'), '["evil"]');
  // A non-JSON neighbour: the route appends `.json`, so this must be unreachable.
  fs.writeFileSync(path.join(fixtures, 'secret.env'), 'AWS_SECRET_ACCESS_KEY=hunter2');
  // The parent of the export gets an index.html too: without the containment check, a pathname
  // that normalizes to a bare `..` resolves to *this* file. It is what makes the check observable.
  fs.writeFileSync(path.join(tmp, 'index.html'), '<html>PARENT — must never be served</html>');
});

describe('resolveFile — resolution order', () => {
  it('serves an exact file', () => {
    expect(resolveFile('/favicon.ico', dist)).toBe(path.join(dist, 'favicon.ico'));
    expect(resolveFile('/_expo/static/js/web/entry.js', dist)).toBe(
      path.join(dist, '_expo', 'static', 'js', 'web', 'entry.js'),
    );
  });

  it('falls back to <path>.html for a static route', () => {
    expect(resolveFile('/fetch', dist)).toBe(path.join(dist, 'fetch.html'));
  });

  it('falls back to <path>/index.html, including for /', () => {
    expect(resolveFile('/', dist)).toBe(path.join(dist, 'index.html'));
    expect(resolveFile('/nested', dist)).toBe(path.join(dist, 'nested', 'index.html'));
    expect(resolveFile('/nested/', dist)).toBe(path.join(dist, 'nested', 'index.html'));
  });

  it('decodes percent-encoded filenames', () => {
    expect(resolveFile('/%66etch', dist)).toBe(path.join(dist, 'fetch.html'));
  });

  it('returns null for an unknown route so the caller can fall back to index.html', () => {
    expect(resolveFile('/does-not-exist', dist)).toBeNull();
    expect(resolveFile('/_expo/static/js/web/nope.js', dist)).toBeNull();
  });
});

describe('resolveFile — traversal guard', () => {
  // Every one of these must be null: the file they aim at exists, so a weakened guard returns a path.
  it.each([
    ['plain traversal', '/../secret.txt'],
    ['repeated traversal', '/../../dist-web/../secret.txt'],
    ['deep traversal', '/../../../../../../../../secret.txt'],
    ['traversal mid-path', '/nested/../../secret.txt'],
    ['relative traversal (no leading slash)', '../secret.txt'],
    // `..` and `../..` are the shapes `path.normalize` cannot collapse and the leading-`../`
    // strip does not match, so the "is it inside dist?" check is the only thing stopping them —
    // and the parent directory really does hold an index.html for them to land on.
    ['bare ..', '..'],
    ['bare ../..', '../..'],
    ['collapsing to ..', 'nested/../..'],
    ['encoded bare ..', '%2e%2e'],
    ['encoded traversal', '/%2e%2e/secret.txt'],
    ['encoded slash', '/..%2Fsecret.txt'],
    ['fully encoded', '/%2E%2E%2Fsecret.txt'],
    ['mixed encoding', '/.%2e/secret.txt'],
    ['double encoded', '/%252e%252e/secret.txt'],
  ])('rejects %s', (_label: string, pathname: string) => {
    expect(resolveFile(pathname, dist)).toBeNull();
  });

  it('never resolves to the secret file for any of those paths', () => {
    // Belt and braces: the assertion above only checks null, this one names the file we protect.
    for (const pathname of ['/../secret.txt', '/%2e%2e/secret.txt', '../secret.txt']) {
      expect(resolveFile(pathname, dist)).not.toBe(outside);
    }
    expect(fs.readFileSync(outside, 'utf8')).toContain('hunter2');
  });

  it('strips a leading ../ rather than following it, so the path lands inside the export', () => {
    // Characterization: `../fetch.html` is sanitized to `fetch.html`, never to the parent's file.
    expect(resolveFile('../fetch.html', dist)).toBe(path.join(dist, 'fetch.html'));
    expect(resolveFile('../../../index.html', dist)).toBe(path.join(dist, 'index.html'));
    expect(fs.readFileSync(resolveFile('../../../index.html', dist), 'utf8')).not.toContain(
      'PARENT',
    );
  });

  it('rejects an absolute path to a real file outside the export', () => {
    expect(resolveFile(outside, dist)).toBeNull();
    expect(resolveFile('/etc/hosts', dist)).toBeNull();
    // `//etc/hosts` — a protocol-relative-looking path — must not resolve either.
    expect(resolveFile('//etc/hosts', dist)).toBeNull();
  });

  it('does not escape into a sibling directory whose name starts with the export dir', () => {
    expect(resolveFile('/../dist-web-evil/index.html', dist)).toBeNull();
    expect(resolveFile('/../dist-web-evil/', dist)).toBeNull();
  });

  it('survives a null byte instead of throwing', () => {
    // fs.statSync throws ERR_INVALID_ARG_VALUE on a NUL; the server must answer, not crash.
    expect(resolveFile('/index.html%00.txt', dist)).toBeNull();
    expect(resolveFile('/%00', dist)).toBeNull();
    expect(resolveFile('/..%00/secret.txt', dist)).toBeNull();
  });

  it('returns null for an undecodable path instead of throwing', () => {
    expect(resolveFile('/%E0%A4%A', dist)).toBeNull();
    expect(resolveFile('/%', dist)).toBeNull();
  });

  it('never returns a path outside the export directory', () => {
    const probes = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '..',
      '../..',
      outside,
      '/etc/hosts',
      '/../dist-web-evil/index.html',
      '/nested/../../secret.txt',
    ];
    for (const probe of probes) {
      const resolved = resolveFile(probe, dist);
      if (resolved !== null) {
        expect(path.relative(dist, resolved).startsWith('..')).toBe(false);
      }
    }
  });
});

/**
 * `/fixtures/<name>` is the offline posts API the Maestro web fetch flow runs against (T13.2).
 * It is a second attacker-reachable route on the same port, so it gets the same treatment as
 * `resolveFile`: the only thing it may ever return is a `.json` file the fixture directory owns.
 */
describe('resolveFixture', () => {
  it('maps /fixtures/<name> to <name>.json', () => {
    expect(resolveFixture('/fixtures/posts', fixtures)).toBe(path.join(fixtures, 'posts.json'));
  });

  it('ignores any path that is not under /fixtures/', () => {
    expect(resolveFixture('/', fixtures)).toBeNull();
    expect(resolveFixture('/fetch', fixtures)).toBeNull();
    // Exactly `/fixtures` (no trailing slash) is not a fixture request either.
    expect(resolveFixture('/fixtures', fixtures)).toBeNull();
    expect(resolveFixture('/api/fixtures/posts', fixtures)).toBeNull();
  });

  it('returns null for a fixture that does not exist', () => {
    expect(resolveFixture('/fixtures/comments', fixtures)).toBeNull();
  });

  it('rejects anything but a single lowercase segment', () => {
    const rejected = [
      '/fixtures/posts.json', // the extension is appended, never supplied
      '/fixtures/nested/deep',
      '/fixtures/secret.env',
      '/fixtures/POSTS',
      '/fixtures/-posts',
      '/fixtures/posts_1',
      '/fixtures/', // empty name
      '/fixtures/..',
      '/fixtures/../secret',
      '/fixtures/../../dist-web/index',
      '/fixtures/%2e%2e/secret',
      '/fixtures/%2e%2e%2fsecret',
      '/fixtures/..%00',
      `/fixtures${outside}`,
      '/fixtures//etc/hosts',
      '/fixtures/../fixtures-evil/posts',
    ];
    for (const pathname of rejected) {
      expect(resolveFixture(pathname, fixtures)).toBeNull();
    }
  });

  it('never returns a path outside the fixture directory', () => {
    const probes = [
      '/fixtures/posts',
      '/fixtures/../secret',
      '/fixtures/../../secret',
      '/fixtures/../fixtures-evil/posts',
      '/fixtures/nested/deep',
      `/fixtures/${outside}`,
    ];
    for (const probe of probes) {
      const resolved = resolveFixture(probe, fixtures);
      if (resolved !== null) {
        expect(path.relative(fixtures, resolved).startsWith('..')).toBe(false);
        expect(resolved.endsWith('.json')).toBe(true);
      }
    }
    expect(fs.readFileSync(path.join(fixtures, 'secret.env'), 'utf8')).toContain('hunter2');
  });

  it('the static resolver does not serve fixtures, and vice versa', () => {
    // The two routes are disjoint: the server picks by prefix, so neither can stand in for the
    // other if one of them is ever weakened.
    expect(resolveFile('/fixtures/posts', dist)).toBeNull();
    expect(resolveFixture('/index.html', fixtures)).toBeNull();
  });
});
