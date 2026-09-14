#!/usr/bin/env node
/**
 * `resolve` job of .eas/workflows/rollout.yml (T11.3): the facts the approver needs before a
 * production rollout is ramped, and the three refusals that make the ramp safe.
 *
 *   node scripts/eas/rollout-resolve.js --group <id> --to 50 [--outputs outputs.txt]
 *
 * Refuses when the group is not on `production` (only promote.yml / backport.yml publish there),
 * when it has no in-progress rollout (published at 100, or already completed — nothing to ramp),
 * and when the requested share is BELOW the current one: ramps go up only, because lowering a
 * rollout does not un-install the update (docs/release-ladder.md → Staged rollouts).
 *
 * Exit codes follow scripts/lib/args.js (0 ok, 1 refused, 2 usage). Plain Node built-ins only.
 */
const fs = require('node:fs');

const { ScriptError, parseArgs: parseCli, runMain } = require('../lib/args');
const { easJson, updateView } = require('./update-view');

const CLI = {
  name: 'rollout-resolve',
  usage: `Usage: node scripts/eas/rollout-resolve.js --group <id> --to <percentage>

Resolves the production update group rollout.yml is about to ramp.

Options:
  --group <id>        production update group with an in-progress rollout (required)
  --to <n>            the new share of production users, 1-100 (required)
  --outputs <file>    where to write the key<TAB>value step outputs (default: outputs.txt)`,
  options: {
    group: { type: 'string', required: true },
    to: { type: 'number', integer: true, min: 1, required: true },
    outputs: { type: 'string', default: 'outputs.txt' },
  },
};

/** The group's rows, its current rollout and the step outputs. Pure given `run`. */
function resolve(group, to, run = easJson) {
  const updates = updateView(group, run);
  const update = updates[0];
  if (update.branch !== 'production') {
    throw new ScriptError(
      `Update group ${group} is on branch "${update.branch}" — only production groups roll out (promote.yml).`,
    );
  }
  const rollout = update.rolloutPercentage;
  if (rollout === undefined || rollout === null) {
    throw new ScriptError(
      `Update group ${group} has no in-progress rollout (published at 100, or already completed) — nothing to ramp.`,
    );
  }
  if (Number(to) < rollout) {
    throw new ScriptError(
      `rollout_percentage ${to} is below the current ${rollout}% — ramps go up only (docs/release-ladder.md → Staged rollouts).`,
    );
  }
  return {
    updates,
    rollout,
    outputs: { rollout: String(rollout), message: (update.message ?? '').slice(0, 120) },
  };
}

function main(argv) {
  const { values, help } = parseCli(argv, CLI);
  if (help) return 0;
  if (values.to > 100) throw new ScriptError(`--to must be 1-100 (got ${values.to}).`);

  const group = values.group.trim();
  const { updates, rollout, outputs } = resolve(group, values.to);
  console.log(`group ${group} on ${updates[0].branch}: ${rollout}% → ${values.to}%`);
  for (const update of updates) {
    console.log(`  ${update.platform} runtime ${update.runtimeVersion} — ${update.message ?? ''}`);
  }
  fs.writeFileSync(
    values.outputs,
    Object.entries(outputs)
      .map(([key, value]) => `${key}\t${value}`)
      .join('\n'),
  );
  return 0;
}

module.exports = { CLI, resolve };

if (require.main === module) runMain(main);
