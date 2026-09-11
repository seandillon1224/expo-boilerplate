/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { spawnSync } = require('node:child_process');
const { classifySkip, evaluate, loadBudget, parseArgs } = require('../observe-check');

// Jest runs from the repo root (rootDir); the script resolves --input against it too.
const ROOT = process.cwd();
const FIXTURES = 'scripts/__tests__/fixtures';
const OK = `${FIXTURES}/observe-summary-ok.json`;
const BREACH = `${FIXTURES}/observe-summary-breach.json`;

const budget = {
  unit: 'ms',
  metric: 'tti',
  minSamples: 30,
  ios: { median: 2000, p90: 3000 },
  android: { median: 2500, p90: 3500 },
};

const okReport = require('./fixtures/observe-summary-ok.json');
const breachReport = require('./fixtures/observe-summary-breach.json');

/** Runs the script as the CLI does, offline via --input, and returns exit code + combined output. */
function runCli(args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/observe-check.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '', OBSERVE_CHECK_STRICT: '' },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('evaluate', () => {
  it('converts seconds to ms and passes rows within budget', () => {
    const rows = evaluate(okReport, budget, { version: '1.0.0' });
    expect(rows.map((r: { platform: string; status: string }) => [r.platform, r.status])).toEqual([
      ['android', 'ok'],
      ['ios', 'ok'],
    ]);
    const ios = rows.find((r: { platform: string }) => r.platform === 'ios');
    expect(ios.checks).toEqual([
      { stat: 'median', actualMs: 1420, limitMs: 2000, ok: true },
      { stat: 'p90', actualMs: 2600, limitMs: 3000, ok: true },
    ]);
  });

  it('marks rows below minSamples as insufficient instead of failing them', () => {
    const rows = evaluate(okReport, budget, { version: '0.9.0' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: 'ios', samples: 4, status: 'insufficient' });
    // 3.9 s would breach both limits if the row had enough samples.
    expect(rows[0].breaches.map((c: { stat: string }) => c.stat)).toEqual(['median', 'p90']);
  });

  it('reports a breach with the offending statistics', () => {
    const rows = evaluate(breachReport, budget);
    const ios = rows.find((r: { platform: string }) => r.platform === 'ios');
    const android = rows.find((r: { platform: string }) => r.platform === 'android');
    expect(ios.status).toBe('breach');
    expect(ios.breaches).toEqual([{ stat: 'p90', actualMs: 4250, limitMs: 3000, ok: false }]);
    expect(android.status).toBe('ok');
  });

  it('filters by platform and by update id', () => {
    expect(evaluate(okReport, budget, { platform: 'android' })).toHaveLength(1);
    expect(
      evaluate(okReport, budget, { updateId: '11111111-aaaa-4bbb-8ccc-000000000001' }),
    ).toHaveLength(2);
    expect(evaluate(okReport, budget, { updateId: 'nope' })).toHaveLength(0);
  });

  it('reports no-limits when the budget has nothing for a platform', () => {
    const rows = evaluate(okReport, { ...budget, android: undefined }, { version: '1.0.0' });
    expect(rows.find((r: { platform: string }) => r.platform === 'android').status).toBe(
      'no-limits',
    );
  });
});

describe('loadBudget', () => {
  it('accepts the checked-in observe-budget.json', () => {
    expect(loadBudget('observe-budget.json')).toMatchObject({ unit: 'ms', metric: 'tti' });
  });
});

describe('parseArgs', () => {
  it('reads flags in both --flag value and --flag=value forms', () => {
    expect(
      parseArgs(['--platform', 'ios', '--days=14', '--version', '1.2.0', '--strict']),
    ).toMatchObject({
      platform: 'ios',
      days: 14,
      version: '1.2.0',
      strict: true,
    });
  });

  it('rejects unknown platforms and bad windows', () => {
    expect(() => parseArgs(['--platform', 'web'])).toThrow(/--platform/);
    expect(() => parseArgs(['--days', '0'])).toThrow(/--days/);
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown argument/);
  });
});

describe('classifySkip', () => {
  it('recognises setup gaps that must not fail the template', () => {
    expect(classifySkip('Error: An Expo user account is required. Log in with `eas login`.')).toBe(
      'auth',
    );
    expect(classifySkip('EAS_OBSERVE_PLAN_UPGRADE_REQUIRED: upgrade your plan')).toBe('plan');
    expect(classifySkip('GraphQL request failed: something else')).toBeNull();
  });
});

describe('CLI (--input, no network)', () => {
  it('exits 0 on a report within budget', () => {
    const { status, output } = runCli(['--input', OK]);
    expect(status).toBe(0);
    expect(output).toContain('OK   ios 1.0.0 (12)');
    expect(output).toContain('SKIP ios 0.9.0 (11): 4 samples');
    expect(output).toContain('within the tti budget');
  });

  it('exits 1 on a breach', () => {
    const { status, output } = runCli(['--input', BREACH]);
    expect(status).toBe(1);
    expect(output).toContain('FAIL ios 1.1.0 (13)');
    expect(output).toContain('over on p90');
  });

  it('passes with a notice when every row is below minSamples, and fails under --strict', () => {
    expect(runCli(['--input', OK, '--version', '0.9.0'])).toMatchObject({ status: 0 });
    expect(runCli(['--input', OK, '--version', '0.9.0', '--strict'])).toMatchObject({ status: 1 });
  });

  it('passes with a notice when the window holds no rows', () => {
    const { status, output } = runCli(['--input', OK, '--version', '9.9.9']);
    expect(status).toBe(0);
    expect(output).toContain('no tti samples');
  });
});
