#!/usr/bin/env bun
/**
 * Static file server for the web export (PLAN.md decision 10: Maestro web runs against the
 * static export, never the dev server).
 *
 *   bun scripts/serve-web.js            # serves dist-web/ on http://localhost:8081
 *   PORT=3000 DIST=dist-web bun scripts/serve-web.js
 *
 * `expo export --platform web` with `web.output: 'static'` writes one HTML file per route
 * (`index.html`, `fetch.html`, `settings.html`, ...). Resolution order for a request path:
 *   1. the exact file (`/_expo/static/js/...`, `/favicon.ico`)
 *   2. `<path>.html`            (`/fetch` -> `fetch.html`)
 *   3. `<path>/index.html`      (`/` -> `index.html`)
 *   4. SPA fallback to `index.html` so client-side navigation survives a reload.
 *
 * Bun-only on purpose: `Bun.serve` needs no dependency and the repo is Bun-only anyway.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, process.env.DIST || 'dist-web');
const PORT = Number(process.env.PORT || 8081);

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`serve-web: ${DIST}/index.html not found. Run \`bun run export:web\` first.`);
  process.exit(1);
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(DIST, relative);
  // Never serve anything outside the export directory.
  if (!target.startsWith(DIST + path.sep) && target !== DIST) return null;

  const candidates = [target, `${target}.html`, path.join(target, 'index.html')];
  return candidates.find(isFile) ?? null;
}

const server = Bun.serve({
  port: PORT,
  fetch(request) {
    const { pathname } = new URL(request.url);
    const file = resolveFile(pathname) ?? path.join(DIST, 'index.html');
    const headers = { 'Cache-Control': 'no-store' };
    return new Response(Bun.file(file), { headers });
  },
});

console.log(`serve-web: serving ${path.relative(ROOT, DIST)}/ at http://localhost:${server.port}`);
