#!/usr/bin/env bun
/**
 * Static file server for the web export (PLAN.md decision 10: Maestro web runs against the
 * static export, never the dev server).
 *
 *   bun scripts/serve-web.js            # serves dist-web/ on http://localhost:8081
 *   PORT=3000 DIST=dist-web bun scripts/serve-web.js
 *
 * It also serves `.maestro/fixtures/*.json` under `/fixtures/` (T13.2) so the web fetch flow can
 * run with no network: `bun run export:web:e2e` bakes `EXPO_PUBLIC_API_URL=<host>/fixtures` into
 * the export, and `${API_URL}/posts?_limit=10` then resolves to `.maestro/fixtures/posts.json`.
 *
 * `expo export --platform web` with `web.output: 'static'` writes one HTML file per route
 * (`index.html`, `fetch.html`, `settings.html`, ...). Resolution order for a request path:
 *   1. the exact file (`/_expo/static/js/...`, `/favicon.ico`)
 *   2. `<path>.html`            (`/fetch` -> `fetch.html`)
 *   3. `<path>/index.html`      (`/` -> `index.html`)
 *   4. nothing matched: `+not-found.html` with a 404 status (T13.4), the same thing a real
 *      static host does with the export; `index.html` only if the app has no `+not-found` route.
 *
 * Bun-only on purpose: `Bun.serve` needs no dependency and the repo is Bun-only anyway.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, process.env.DIST || 'dist-web');
const FIXTURES = path.resolve(ROOT, process.env.FIXTURES || '.maestro/fixtures');
const PORT = Number(process.env.PORT || 8081);

/** Request prefix the fixture API answers on; `EXPO_PUBLIC_API_URL` ends with it. */
const FIXTURE_PREFIX = '/fixtures/';
/** One path segment, no dots: `..`, `/` and `%2e%2e` cannot survive this. */
const FIXTURE_NAME = /^[a-z0-9][a-z0-9-]*$/;

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Maps a request pathname to a file inside `dist`, or null when nothing matches. This is a
 * security boundary: a static server that happily resolves `/../../.env` hands the whole machine
 * to anyone who can reach the port, so every path — decoded, normalized, absolute or not — has to
 * land inside `dist` before it is read. `dist` is a parameter so tests can point it at a fixture.
 */
function resolveFile(pathname, dist = DIST) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(dist, relative);
  // Never serve anything outside the export directory.
  if (!target.startsWith(dist + path.sep) && target !== dist) return null;

  const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
  return candidates.find(isFile) ?? null;
}

/**
 * Maps `/fixtures/<name>` to `<fixtures>/<name>.json`, or null when the request is not for a
 * fixture (or names one that does not exist). Deliberately not a second static server: the name
 * is a single allow-listed segment (`[a-z0-9-]`, no dot, no slash, never percent-decoded) and the
 * `.json` extension is appended here, so no request can reach a file the fixture directory does
 * not own — `..`, `%2e%2e` and `/etc/hosts` all fail the pattern before a path is built.
 */
function resolveFixture(pathname, fixtures = FIXTURES) {
  if (!pathname.startsWith(FIXTURE_PREFIX)) return null;
  const name = pathname.slice(FIXTURE_PREFIX.length);
  if (!FIXTURE_NAME.test(name)) return null;
  const target = path.join(fixtures, `${name}.json`);
  // Belt and braces: the pattern already guarantees containment.
  if (!target.startsWith(fixtures + path.sep)) return null;
  return isFile(target) ? target : null;
}

/**
 * What to serve when nothing matched. `expo export` writes `src/app/+not-found.tsx` out as
 * `+not-found.html`, so an unknown path gets the app's own 404 screen with a 404 status — which
 * is what EAS Hosting and any other static host do, and what the `web/not-found` Maestro flow
 * asserts. Falling back to `index.html` (200) would silently serve Home for a typo.
 */
function resolveFallback(dist = DIST) {
  const notFound = path.join(dist, '+not-found.html');
  if (isFile(notFound)) return { file: notFound, status: 404 };
  return { file: path.join(dist, 'index.html'), status: 200 };
}

function serve() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`serve-web: ${DIST}/index.html not found. Run \`bun run export:web\` first.`);
    process.exitCode = 1;
    return;
  }
  const server = Bun.serve({
    port: PORT,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const headers = { 'Cache-Control': 'no-store' };
      if (pathname.startsWith(FIXTURE_PREFIX)) {
        const fixture = resolveFixture(pathname);
        // No SPA fallback here: a fixture typo must fail loudly as a 404, not hand the app
        // index.html and surface as a JSON parse error inside the flow.
        if (!fixture) return new Response('fixture not found', { status: 404, headers });
        return new Response(Bun.file(fixture), { headers });
      }
      const file = resolveFile(pathname);
      if (file) return new Response(Bun.file(file), { headers });
      const fallback = resolveFallback();
      return new Response(Bun.file(fallback.file), { headers, status: fallback.status });
    },
  });
  console.log(
    `serve-web: serving ${path.relative(ROOT, DIST)}/ at http://localhost:${server.port}` +
      ` (fixtures: ${path.relative(ROOT, FIXTURES)}/ at /fixtures/<name>)`,
  );
}

module.exports = { resolveFallback, resolveFile, resolveFixture };

if (require.main === module) serve();
