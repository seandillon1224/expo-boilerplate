'use strict';
/**
 * One way to reach a repo-pinned CLI from a script (T11.2).
 *
 * Before this, the same binary was invoked three different ways — `bun run eas` (a package.json
 * script hop), `node_modules/.bin/eas` (hand-joined in two scripts) and `bunx` (which resolves the
 * pinned copy but falls back to *downloading* one when `bun install` has not run). Only the
 * `node_modules/.bin` path is both pinned and honest about a missing install, so it is the one
 * spelling left.
 *
 * `binPath(name)` is the absolute path to `node_modules/.bin/<name>`; `easBin` is the one every
 * caller needed. Nothing here checks that the file exists: the callers already report "run
 * `bun install`" better than a generic message could, and `spawnSync` reports ENOENT anyway.
 *
 * Plain Node built-ins only — see the rule in docs/conventions.md → "Scripts run under node".
 */
const path = require('node:path');

/** Repo root, from this file's location — never `process.cwd()` (scripts run from anywhere). */
const projectRoot = path.resolve(__dirname, '..', '..');

/** Absolute path of a repo-pinned CLI, e.g. `binPath('expo')`. */
function binPath(name) {
  return path.join(projectRoot, 'node_modules', '.bin', name);
}

/** The repo-pinned eas-cli (`package.json` devDependency), never a global or `bunx` copy. */
const easBin = binPath('eas');

module.exports = { binPath, easBin, projectRoot };
