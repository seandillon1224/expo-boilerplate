/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { regressionsIn } = require('../reassure-gate');

// Jest runs from the repo root (rootDir); the script resolves --input against it too.
const ROOT = process.cwd();
const FIXTURES = 'scripts/__tests__/fixtures';
const PASS = `${FIXTURES}/reassure-pass.json`;
const REGRESSION = `${FIXTURES}/reassure-regression.json`;
const ERRORS = `${FIXTURES}/reassure-errors.json`;

const pass = require('./fixtures/reassure-pass.json');
const regression = require('./fixtures/reassure-regression.json');

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/reassure-gate.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('regressionsIn', () => {
  it('ignores a significant speed-up', () => {
    // The pass fixture's only significant entry is 4.0 ms -> 3.1 ms: faster, so not a regression.
    expect(pass.significant).toHaveLength(1);
    expect(regressionsIn(pass)).toEqual([]);
  });

  it('returns only the entries that got slower', () => {
    expect(regressionsIn(regression).map((e: { name: string }) => e.name)).toEqual([
      'FetchScreen renders the list once posts resolve',
      'TabsScreen renders',
    ]);
  });

  it('treats a report with no significant key as clean', () => {
    expect(regressionsIn({})).toEqual([]);
    expect(regressionsIn({ significant: [] })).toEqual([]);
  });

  it('does not count a zero diff as a regression', () => {
    expect(regressionsIn({ significant: [{ name: 'flat', durationDiff: 0 }] })).toEqual([]);
  });
});

describe('CLI', () => {
  it('passes with a summary when nothing got slower', () => {
    const { status, output } = runCli(['--input', PASS]);
    expect(status).toBe(0);
    expect(output).toContain('no significant render-duration regressions');
    // 1 significant + 1 meaningless compared, 1 added, 1 removed.
    expect(output).toContain('(2 compared, 1 added, 1 removed)');
  });

  it('fails with each regression named, its ms values and its percentage', () => {
    const { status, output } = runCli(['--input', REGRESSION]);
    expect(status).toBe(1);
    expect(output).toContain('reassure-gate: 2 significant render-duration regression(s):');
    expect(output).toContain(
      '- FetchScreen renders the list once posts resolve: 3.2 ms -> 5.6 ms (+75.0%)',
    );
    expect(output).toContain('- TabsScreen renders: 2.0 ms -> 2.6 ms (+30.0%)');
    // The speed-up in the same report is not reported as a regression.
    expect(output).not.toContain('HomeScreen renders:');
  });

  it('fails when the compare run itself errored, before looking at durations', () => {
    const { status, output } = runCli(['--input', ERRORS]);
    expect(status).toBe(1);
    expect(output).toContain('reassure-gate: error: Failed to run test: SettingsScreen renders');
  });

  it('passes with a notice when there is no report (first perf PR, no baseline)', () => {
    const missing = `${FIXTURES}/does-not-exist.json`;
    const { status, output } = runCli(['--input', missing]);
    expect(status).toBe(0);
    expect(output).toContain(`${missing} not found (no baseline to compare against); passing.`);
  });

  it('defaults to .reassure/output.json', () => {
    const { status, output } = runCli([]);
    expect(status).toBe(0);
    // Whether or not a local .reassure/output.json exists, the default path is the one used.
    expect(output).toMatch(/\.reassure\/output\.json not found|render-duration regressions/);
    expect(path.isAbsolute(ROOT)).toBe(true);
  });

  it('rejects an unknown flag (exit 2) and prints usage for --help', () => {
    expect(runCli(['--bogus']).status).toBe(2);
    const help = runCli(['--help']);
    expect(help.status).toBe(0);
    expect(help.output).toContain('Usage: node scripts/reassure-gate.js');
  });
});
