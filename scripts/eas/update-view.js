'use strict';
/**
 * The one way an EAS workflow job asks the API about an update group (T11.3).
 *
 * `promote-resolve.js` and `rollout-resolve.js` both start from `eas update:view <group>` and both
 * used to inline the same `execFileSync(... '--json', '--non-interactive')` + `JSON.parse` dance in
 * a `node -e` heredoc. This is that dance, once, with the "group not found" failure worded the same
 * way in both callers.
 *
 * `easJson` is injectable everywhere it is used (`run` parameters below) so the resolvers can be
 * unit-tested without an EAS session — nothing here is exercised by the test suite itself.
 *
 * Plain Node built-ins only: these run in EAS workflow jobs (scripts/__tests__/builtins-only.test.ts).
 */
const { execFileSync } = require('node:child_process');

const { ScriptError } = require('../lib/args');
const { easBin } = require('../lib/bin');

/**
 * Runs the repo-pinned eas-cli with `--json --non-interactive` and parses stdout.
 * stderr is inherited, so the CLI's own diagnostics stay in the job log.
 */
function easJson(args) {
  const stdout = execFileSync(easBin, [...args, '--json', '--non-interactive'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return JSON.parse(stdout);
}

/**
 * `eas update:view <group>` → the platform rows of that group (one per published platform).
 * Throws a `ScriptError` (exit 1) when the group does not exist.
 */
function updateView(group, run = easJson) {
  const updates = run(['update:view', group]);
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new ScriptError(`Update group ${group} not found.`);
  }
  return updates;
}

module.exports = { easJson, updateView };
