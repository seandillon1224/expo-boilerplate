#!/usr/bin/env node
/**
 * `resolve` job of .eas/workflows/promote.yml (T11.3): which staging update group is being
 * promoted, and is it critical?
 *
 *   node scripts/eas/promote-resolve.js [--group <id>] [--critical yes|no] [--outputs outputs.txt]
 *
 * Empty `--group` = the newest group on the `staging` branch. The group must BE on `staging`:
 * promotion republishes exactly the bytes staging has been running, so anything else is refused.
 *
 * `critical` (ADR-0003) lives in the manifest, which a republish carries unchanged — so
 * `--critical yes` only VERIFIES the flag is already there (every platform's manifest resolves
 * `extra.updatePolicy` to `forced`); it can never add it.
 *
 * Writes the step outputs as `key<TAB>value` lines to `--outputs` (the workflow loops them through
 * `set-output`), and prints them as JSON so the approver can read group / commit / runtime / policy
 * on the run page BEFORE approving.
 *
 * Exit codes follow scripts/lib/args.js (0 ok, 1 refused, 2 usage). Plain Node built-ins only.
 */
const fs = require('node:fs');

const { ScriptError, parseArgs: parseCli, runMain } = require('../lib/args');
const { easJson, updateView } = require('./update-view');

const CLI = {
  name: 'promote-resolve',
  usage: `Usage: node scripts/eas/promote-resolve.js [options]

Resolves the staging update group promote.yml is about to republish.

Options:
  --group <id>          update group to promote; empty = newest on \`staging\`
  --critical yes|no     yes = refuse unless the group is already critical (default: no)
  --outputs <file>      where to write the key<TAB>value step outputs (default: outputs.txt)`,
  options: {
    group: { type: 'string', default: '' },
    critical: { type: 'string', choices: ['yes', 'no'], default: 'no' },
    outputs: { type: 'string', default: 'outputs.txt' },
  },
};

/** Explicit group, else the newest group on `staging`. */
function resolveGroupId(input, run) {
  const group = (input || '').trim();
  if (group) return group;
  const listed = run(['update:list', '--branch', 'staging', '--limit', '1']);
  const newest = listed?.currentPage?.[0]?.group ?? '';
  if (!newest) throw new ScriptError('No update group on `staging` yet (deploy-staging.yml).');
  return newest;
}

/** The group's rows plus the step outputs derived from them. Pure given `run`. */
function resolve(input, run = easJson) {
  const group = resolveGroupId(input, run);
  const updates = updateView(group, run);
  if (updates[0].branch !== 'staging') {
    throw new ScriptError(
      `Update group ${group} is on branch "${updates[0].branch}", not staging — promote only what staging has run.`,
    );
  }
  const runtimeOf = (platform) =>
    updates.find((u) => u.platform === platform)?.runtimeVersion ?? '';
  return {
    updates,
    outputs: {
      group_id: group,
      ios_runtime: runtimeOf('ios'),
      android_runtime: runtimeOf('android'),
      commit: updates[0].gitCommitHash ?? '',
      message: (updates[0].message ?? '').slice(0, 120),
    },
  };
}

/** `extra.updatePolicy` out of one update's manifest; never throws (the reason is the value). */
const readPolicy = (update, fetchJson) =>
  fetchJson(update.manifestPermalink).then(
    (manifest) => manifest?.extra?.expoClient?.extra?.updatePolicy ?? 'silent',
    (error) => `unreadable: ${error.message}`,
  );

const fetchManifest = (url) =>
  fetch(url, { headers: { accept: 'application/json' } }).then((r) => r.json());

/** `['ios=forced', 'android=silent']`, in the group's platform order. */
function readPolicies(updates, fetchJson = fetchManifest) {
  return Promise.all(updates.map(async (u) => `${u.platform}=${await readPolicy(u, fetchJson)}`));
}

/** A group is critical only when EVERY platform's manifest says `forced`. */
const isCritical = (policies) => policies.every((p) => p.endsWith('=forced'));

async function main(argv) {
  const { values, help } = parseCli(argv, CLI);
  if (help) return 0;

  const { updates, outputs } = resolve(values.group);
  console.log(JSON.stringify(outputs, null, 2));
  fs.writeFileSync(
    values.outputs,
    Object.entries(outputs)
      .map(([key, value]) => `${key}\t${value}`)
      .join('\n'),
  );

  const policies = await readPolicies(updates);
  const critical = isCritical(policies);
  console.log(`updatePolicy ${policies.join(' ')} → ${critical ? 'CRITICAL' : 'not critical'}`);
  if (values.critical === 'yes' && !critical) {
    throw new ScriptError(
      `critical=yes but group ${outputs.group_id} is not critical — publish to staging with critical=yes and promote that group.`,
    );
  }
  return 0;
}

module.exports = { CLI, isCritical, readPolicies, resolve, resolveGroupId };

if (require.main === module) runMain(main);
