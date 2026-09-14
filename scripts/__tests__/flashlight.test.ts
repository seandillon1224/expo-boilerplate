/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULTS,
  buildTestArgs,
  gateReason,
  renderSummary,
  resolveOptions,
  shouldInstall,
  summarize,
} = require('../flashlight');

const ROOT = process.cwd();
const fixture = require('./fixtures/flashlight-results.json');

/** Runs the script as the hook does and returns exit code + combined output. */
function runCli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ['scripts/flashlight.js', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '', EAS_BUILD: '', FLASHLIGHT: '', ...env },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('gateReason', () => {
  it('runs when the constant is unset, empty or enabled', () => {
    expect(gateReason(undefined)).toBeNull();
    expect(gateReason('')).toBeNull();
    expect(gateReason('enabled')).toBeNull();
  });

  it('skips on disabled (or any other value) and says how to enable it', () => {
    expect(gateReason('disabled')).toMatch(/FLASHLIGHT=disabled.*-F flashlight=enabled/);
    expect(gateReason('yes')).toMatch(/^FLASHLIGHT=yes/);
  });
});

describe('shouldInstall', () => {
  it('installs on --install or on a CI / EAS worker, never silently on a laptop', () => {
    expect(shouldInstall({ flags: new Set(), env: {} })).toBe(false);
    expect(shouldInstall({ flags: new Set(['install']), env: {} })).toBe(true);
    expect(shouldInstall({ flags: new Set(), env: { CI: '1' } })).toBe(true);
    expect(shouldInstall({ flags: new Set(), env: { EAS_BUILD: 'true' } })).toBe(true);
  });
});

describe('resolveOptions', () => {
  it('applies the defaults', () => {
    const opts = resolveOptions({ platform: 'android', flags: new Set(), values: {}, env: {} });
    expect(opts).toMatchObject({
      platform: 'android',
      device: undefined,
      outDir: path.join(ROOT, DEFAULTS.out),
      iterations: 5,
      duration: 10_000,
      flow: '.maestro/flows/fetch.yaml',
      install: false,
      noFail: false,
    });
  });

  it('reads every flag', () => {
    const opts = resolveOptions({
      platform: 'android',
      flags: new Set(['no-fail', 'install']),
      values: {
        device: 'emulator-5554',
        out: '/tmp/fl',
        iterations: '3',
        duration: '0',
        flow: 'x.yaml',
        title: 't',
      },
      env: {},
    });
    expect(opts).toMatchObject({
      device: 'emulator-5554',
      outDir: '/tmp/fl',
      iterations: 3,
      duration: 0,
      flow: 'x.yaml',
      title: 't',
      install: true,
      noFail: true,
    });
  });

  it('rejects a non-integer iteration count', () => {
    expect(() =>
      resolveOptions({
        platform: 'android',
        flags: new Set(),
        values: { iterations: 'many' },
        env: {},
      }),
    ).toThrow(/--iterations/);
  });
});

describe('buildTestArgs', () => {
  it('pins Maestro to the device and passes the app id both ways', () => {
    const args = buildTestArgs({
      id: 'com.example.dev',
      flow: '.maestro/flows/fetch.yaml',
      iterations: 5,
      duration: 10_000,
      resultsFile: '/out/results.json',
      title: 'abc1234',
      maestro: '/home/me/.maestro/bin/maestro',
      device: 'emulator-5554',
    });
    expect(args).toEqual([
      'test',
      '--bundleId',
      'com.example.dev',
      '--testCommand',
      '/home/me/.maestro/bin/maestro --device emulator-5554 test .maestro/flows/fetch.yaml -e MAESTRO_APP_ID=com.example.dev',
      '--iterationCount',
      '5',
      '--duration',
      '10000',
      '--resultsFilePath',
      '/out/results.json',
      '--resultsTitle',
      'abc1234',
    ]);
  });

  it('omits --duration at 0 and --device without one', () => {
    const args = buildTestArgs({
      id: 'a',
      flow: 'f.yaml',
      iterations: 1,
      duration: 0,
      resultsFile: 'r.json',
      title: 't',
      maestro: 'maestro',
    });
    expect(args).not.toContain('--duration');
    expect(args[4]).toBe('maestro test f.yaml -e MAESTRO_APP_ID=a');
  });
});

describe('summarize', () => {
  it('averages time and measures across iterations without computing a score', () => {
    expect(summarize(fixture)).toEqual({
      name: 'abc1234',
      iterations: 3,
      failed: 1,
      averageTimeMs: (4200 + 3800 + 9000) / 3,
      // iteration 1: (60 + 40) / 2 = 50; iteration 2: 60; iteration 3: no measures.
      averageCpuPercent: 55,
      averageRamMb: (210 + 240) / 2,
      averageFps: (59 + 56) / 2,
    });
  });

  it('copes with an empty or malformed file', () => {
    expect(summarize({})).toEqual({
      name: '',
      iterations: 0,
      failed: 0,
      averageTimeMs: null,
      averageCpuPercent: null,
      averageRamMb: null,
      averageFps: null,
    });
    expect(summarize(null).iterations).toBe(0);
  });

  it('renders n/a for missing measures', () => {
    const text = renderSummary(summarize({ name: 'x', iterations: [{ time: 1000 }] }));
    expect(text.split('\n')).toEqual([
      'Flashlight: x',
      '  iterations   1',
      '  avg time     1000 ms',
      '  avg CPU      n/a (all app threads)',
      '  avg RAM      n/a',
      '  avg FPS      n/a',
    ]);
  });
});

describe('cli', () => {
  let out: string;
  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlight-'));
  });
  afterEach(() => {
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('skips with exit 0 and a README when the repo constant is disabled', () => {
    const { status, output } = runCli(['--platform', 'android', '--out', out], {
      FLASHLIGHT: 'disabled',
    });
    expect(status).toBe(0);
    expect(output).toMatch(/skipped: FLASHLIGHT=disabled/);
    expect(fs.readFileSync(path.join(out, 'README.txt'), 'utf8')).toMatch(
      /Skipped: FLASHLIGHT=disabled/,
    );
  });

  it('refuses iOS: exit 1 by default, exit 0 with --no-fail', () => {
    expect(runCli(['--platform', 'ios', '--out', out])).toMatchObject({ status: 1 });
    const { status, output } = runCli(['--platform', 'ios', '--out', out, '--no-fail']);
    expect(status).toBe(0);
    expect(output).toMatch(/Android only/);
    expect(fs.existsSync(path.join(out, 'README.txt'))).toBe(true);
  });

  it('rejects a malformed --iterations', () => {
    const { status, output } = runCli(['--platform', 'android', '--out', out, '--iterations', 'x']);
    expect(status).toBe(1);
    expect(output).toMatch(/--iterations must be/);
  });
});
