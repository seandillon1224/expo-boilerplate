#!/usr/bin/env node
/**
 * The fingerprint gate of the two rungs that cut binaries (T11.3): promote.yml (`--mode uat` /
 * `--mode production`) and release.yml (`--mode release`). Same question in both — "is there
 * already a build of this fingerprint?" — and opposite answers to a miss, which is why they stay
 * one file: the matrix lives in one place instead of drifting across two shell functions.
 *
 *   node scripts/eas/fingerprint-gate.js --mode uat|production|release [--outputs outputs.txt]
 *
 * Inputs come from the job `env:` block, because they are all `after.<job>.outputs.*` expressions
 * (never `needs.*` — see docs/ci-overview.md):
 *
 *   promote  IOS_RUNTIME ANDROID_RUNTIME  the GROUP's runtime per platform ('' = not in the group)
 *            IOS_FP ANDROID_FP            this checkout's fingerprint for the target variant
 *            IOS_BUILD ANDROID_BUILD      a target-profile build running that runtime, if any
 *            GROUP COMMIT                 for the refusal message
 *   release  IOS_FP ANDROID_FP IOS_BUILD ANDROID_BUILD  TAG PLATFORMS FORCE
 *
 * Verdicts, per platform:
 *   uat         hit → reuse it · miss & checkout fingerprint == group runtime → cut a uat build
 *               · miss & fingerprint differs → REFUSE (re-run from the group's commit)
 *   production  hit → reuse it · miss → REFUSE (a store release must ship that runtime first)
 *   release     hit → skip, green (nothing native changed since the last store build) unless
 *               force=yes · miss → release
 *
 * Outputs `build_ios` / `build_android` (promote) or `release_ios` / `release_android` (release)
 * as `key<TAB>value` lines in `--outputs`; the workflow loops them through `set-output`.
 *
 * Exit codes follow scripts/lib/args.js (0 ok, 1 refused, 2 usage). Plain Node built-ins only.
 */
const fs = require('node:fs');

const { ScriptError, parseArgs: parseCli, runMain } = require('../lib/args');

const PLATFORMS = ['ios', 'android'];

const CLI = {
  name: 'fingerprint-gate',
  usage: `Usage: node scripts/eas/fingerprint-gate.js --mode uat|production|release

Decides, per platform, whether a build has to be cut. Reads the job env (see the file header).

Options:
  --mode uat|production|release   which rung is asking (required)
  --outputs <file>                key<TAB>value step outputs (default: outputs.txt)`,
  options: {
    mode: { type: 'string', choices: ['uat', 'production', 'release'], required: true },
    outputs: { type: 'string', default: 'outputs.txt' },
  },
};

const upper = (platform, suffix) => `${platform.toUpperCase()}_${suffix}`;

/**
 * promote.yml: `--mode` doubles as the target channel. A HIT needs no build (`false`); only a uat
 * miss from this very checkout cuts one.
 */
function promoteGate(target, env) {
  const log = [];
  const outputs = {};
  let refused = false;
  for (const platform of PLATFORMS) {
    const runtime = env[upper(platform, 'RUNTIME')] || '';
    const fingerprint = env[upper(platform, 'FP')] || '';
    const build = env[upper(platform, 'BUILD')] || '';
    let cutBuild = false;
    if (!runtime) {
      log.push(`${platform}: not in the group — skipped`);
      outputs[`build_${platform}`] = 'false';
      continue;
    }
    if (build) {
      log.push(`${platform}: HIT — ${target} build ${build} runs ${runtime}`);
    } else if (target === 'production') {
      log.push(
        `${platform}: MISS — no production store build runs runtime ${runtime} (checkout: ${fingerprint}). Tag a release (release.yml), then promote again.`,
      );
      refused = true;
    } else if (fingerprint === runtime) {
      log.push(`${platform}: MISS — cutting a uat build from this checkout (${fingerprint})`);
      cutBuild = true;
    } else {
      log.push(
        `${platform}: MISS — checkout fingerprint ${fingerprint} != group runtime ${runtime}; re-run from the group's commit:`,
        `  bun run eas workflow:run .eas/workflows/promote.yml --ref ${env.COMMIT || '<commit>'} -F target=uat -F update_group_id=${env.GROUP ?? ''}`,
      );
      refused = true;
    }
    outputs[`build_${platform}`] = String(cutBuild);
  }
  return {
    log,
    outputs,
    refusal: refused ? `Fingerprint gate: refusing ${env.GROUP ?? ''} → ${target}.` : '',
  };
}

/** release.yml: an unchanged fingerprint is a green SKIP, not a failure — there is nothing to ship. */
function releaseGate(env) {
  const platforms = env.PLATFORMS || 'both';
  const force = env.FORCE || 'no';
  const tag = env.TAG ?? '';
  const log = [];
  const outputs = {};
  let releasing = false;
  for (const platform of PLATFORMS) {
    const fingerprint = env[upper(platform, 'FP')] || '';
    const build = env[upper(platform, 'BUILD')] || '';
    let release = false;
    if (platforms !== 'both' && platforms !== platform) {
      log.push(`${platform}: not selected (platforms=${platforms}) — skipped`);
    } else if (build && force !== 'yes') {
      log.push(
        `${platform}: fingerprint ${fingerprint} unchanged since last store build ${build}; nothing to release.`,
        '  Bump a native dependency / config plugin to change the fingerprint, or re-run with force=yes.',
      );
    } else if (build) {
      log.push(
        `${platform}: store build ${build} already has fingerprint ${fingerprint} — force=yes, releasing ${tag} anyway`,
      );
      release = true;
      releasing = true;
    } else {
      log.push(
        `${platform}: MISS — no store build with fingerprint ${fingerprint}; releasing ${tag}`,
      );
      release = true;
      releasing = true;
    }
    outputs[`release_${platform}`] = String(release);
  }
  if (!releasing) {
    log.push(
      `Release ${tag} skipped: fingerprint unchanged on every selected platform. Run is green; nothing was built or submitted.`,
    );
  }
  return { log, outputs, refusal: '' };
}

/** The whole decision, pure: `(mode, env) → { log, outputs, refusal }`. */
function gate(mode, env) {
  return mode === 'release' ? releaseGate(env) : promoteGate(mode, env);
}

function main(argv) {
  const { values, help } = parseCli(argv, CLI);
  if (help) return 0;

  const { log, outputs, refusal } = gate(values.mode, process.env);
  for (const line of log) console.log(line);
  fs.writeFileSync(
    values.outputs,
    Object.entries(outputs)
      .map(([key, value]) => `${key}\t${value}`)
      .join('\n'),
  );
  if (refusal) throw new ScriptError(refusal);
  return 0;
}

module.exports = { CLI, gate, promoteGate, releaseGate };

if (require.main === module) runMain(main);
