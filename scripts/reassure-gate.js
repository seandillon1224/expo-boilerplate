#!/usr/bin/env node
/**
 * Reassure CI gate (PLAN.md decision 7).
 *
 *   node scripts/reassure-gate.js [--input .reassure/output.json]
 *
 * Reads the compare report `bun run perf` writes and exits 1 when any test's render duration
 * got statistically significantly slower than the baseline (`significant` entries with a
 * positive `durationDiff`). Speed-ups, added/removed tests, and count-only changes pass.
 * Missing report (no baseline on the base branch yet) passes with a notice so the first
 * PR that introduces a perf test is not blocked.
 *
 * Plain Node/JS (no @types/node) so it runs under `bun` or `node` with no extra deps.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = '.reassure/output.json';

function parseArgs(argv) {
  let input = DEFAULT_INPUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') input = argv[++i];
    else if (arg.startsWith('--input=')) input = arg.slice('--input='.length);
  }
  return { input };
}

function main() {
  const { input } = parseArgs(process.argv.slice(2));
  const file = path.resolve(ROOT, input);
  if (!fs.existsSync(file)) {
    console.log(`reassure-gate: ${input} not found (no baseline to compare against); passing.`);
    return 0;
  }

  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const regressions = (report.significant ?? []).filter((entry) => entry.durationDiff > 0);

  if (report.errors?.length) {
    for (const error of report.errors) console.error(`reassure-gate: error: ${error}`);
    return 1;
  }

  if (regressions.length === 0) {
    const compared = (report.significant?.length ?? 0) + (report.meaningless?.length ?? 0);
    console.log(
      `reassure-gate: no significant render-duration regressions (${compared} compared, ${report.added?.length ?? 0} added, ${report.removed?.length ?? 0} removed).`,
    );
    return 0;
  }

  console.error(`reassure-gate: ${regressions.length} significant render-duration regression(s):`);
  for (const entry of regressions) {
    const percent = (entry.relativeDurationDiff * 100).toFixed(1);
    console.error(
      `  - ${entry.name}: ${entry.baseline.meanDuration.toFixed(1)} ms -> ${entry.current.meanDuration.toFixed(1)} ms (+${percent}%)`,
    );
  }
  return 1;
}

process.exitCode = main();
