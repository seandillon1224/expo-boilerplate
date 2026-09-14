/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { spawnSync } = require('node:child_process');
const {
  CHECKS,
  EXPECTED,
  compareVersions,
  doctorStep,
  parseArgs,
  parseVersion,
  renderTable,
  runChecks,
  summarize,
} = require('../doctor');
const { easBin } = require('../lib/bin');

type Result = { status: number | null; stdout: string; stderr: string };
type Row = {
  id: string;
  title: string;
  required: boolean;
  status: 'ok' | 'warn' | 'missing' | 'skip';
  found: string;
  expected: string;
  hint?: string;
};

const ok = (stdout: string, stderr = ''): Result => ({ status: 0, stdout, stderr });
const failed = (stderr: string): Result => ({ status: 1, stdout: '', stderr });
const absent: Result = { status: null, stdout: '', stderr: '' };

/** Everything a fully provisioned macOS laptop answers; tests override single entries. */
const HEALTHY: Record<string, Result> = {
  'bun --version': ok('1.3.10\n'),
  'node --version': ok('v22.13.1\n'),
  'git --version': ok('git version 2.37.1\n'),
  // The repo-pinned eas-cli is spawned by path (scripts/lib/bin.js), never via `bun run eas`.
  [`${easBin} --version`]: ok('eas-cli/23.2.0 darwin-arm64 node-v22.13.1\n', '$ eas --version\n'),
  [`${easBin} whoami --non-interactive`]: ok('dev@example.com\n'),
  'gh --version': ok('gh version 2.88.1 (2026-08-01)\n'),
  'gh auth status': ok('', 'github.com\n  ✓ Logged in to github.com account octocat (keyring)\n'),
  'maestro --version': ok(
    '2.10.0\n',
    'WARNING: A restricted method in java.lang.System has been called\n',
  ),
  'xcodebuild -version': ok('Xcode 26.6\nBuild version 17F113\n'),
  'xcrun simctl list devices available -j': ok(
    JSON.stringify({ devices: { 'iOS-18-3': [{ name: 'iPhone 16' }, { name: 'iPad' }] } }),
  ),
  'adb version': ok('Android Debug Bridge version 1.0.41\nVersion 36.0.0-13206524\n'),
  'emulator -version': ok('Android emulator version 37.1.11.0 (build_id 15917651) (CL:N/A)\n'),
  'java -version': ok(
    '',
    'openjdk version "21.0.10" 2026-01-20 LTS\nOpenJDK Runtime Environment\n',
  ),
};

type Ctx = {
  root: string;
  home: string;
  platform: string;
  env: Record<string, string | undefined>;
  exists: (p: string) => boolean;
  read: (file: string) => string | null;
  run: (cmd: string, args: string[]) => Result;
  easCliRange?: string;
  calls: string[];
};

function makeCtx(
  overrides: {
    results?: Record<string, Result | undefined>;
    files?: Record<string, string | null>;
    existing?: string[];
    env?: Record<string, string | undefined>;
    platform?: string;
    easCliRange?: string;
  } = {},
): Ctx {
  const results = { ...HEALTHY, ...overrides.results };
  const files: Record<string, string | null> = {
    '.node-version': '22\n',
    '.git/hooks/pre-commit': '#!/bin/sh\n# lefthook\n',
    ...overrides.files,
  };
  const existing = new Set(['/repo/.git', '/sdk', ...(overrides.existing ?? [])]);
  const calls: string[] = [];
  return {
    root: '/repo',
    home: '/home/me',
    platform: overrides.platform ?? 'darwin',
    env: overrides.env ?? { ANDROID_HOME: '/sdk' },
    exists: (p) => existing.has(p),
    read: (file) => files[file] ?? null,
    run: (cmd, args) => {
      const key = [cmd, ...args].join(' ');
      calls.push(key);
      return results[key] ?? absent;
    },
    easCliRange: overrides.easCliRange ?? '^23',
    calls,
  };
}

const byId = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.id, r])) as Record<string, Row>;

describe('version helpers', () => {
  it('parseVersion pulls the first x.y.z out of tool output', () => {
    expect(parseVersion('v22.13.1')).toBe('22.13.1');
    expect(parseVersion('git version 2.37.1 (Apple Git-136)')).toBe('2.37.1');
    expect(parseVersion('Xcode 26.6')).toBe('26.6');
    expect(parseVersion('17')).toBe('17');
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('compareVersions orders numerically, part by part, padding missing parts with 0', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('26.6', '26.6.0')).toBe(0);
    expect(compareVersions('1.3.10', '1.2')).toBe(1);
    expect(compareVersions('2.10.0-rc1', '2.10.0')).toBe(0);
  });
});

describe('runChecks (fake run, nothing real executed)', () => {
  it('reports every row ok on a fully provisioned macOS machine', () => {
    const ctx = makeCtx();
    const rows = runChecks(ctx) as Row[];
    expect(rows.map((r) => r.status)).toEqual(rows.map(() => 'ok'));
    const r = byId(rows);
    expect(r.bun.found).toBe('1.3.10');
    expect(r.node.expected).toBe('22.x (.node-version)');
    expect(r.eas.found).toBe('23.2.0');
    expect(r.eas.expected).toBe('23.x (package.json eas-cli ^23)');
    expect(r['eas-login'].found).toBe('dev@example.com');
    expect(r['gh-auth'].found).toBe('logged in as octocat');
    expect(r.maestro.found).toBe('2.10.0');
    expect(r.xcode.found).toBe('26.6, 2 simulators');
    expect(r.android.found).toBe('adb 1.0.41, emulator 37.1.11');
    expect(r.java.found).toBe('21.0.10');
    expect(rows.filter((row) => row.required).map((row) => row.id)).toEqual(['bun', 'node', 'git']);
  });

  it('marks Bun / Node / git as missing (never warn) when absent or incompatible', () => {
    const rows = byId(
      runChecks(
        makeCtx({
          results: {
            'bun --version': ok('1.1.40\n'),
            'node --version': ok('v20.19.0\n'),
            'git --version': absent,
          },
        }),
      ) as Row[],
    );
    expect(rows.bun).toMatchObject({ status: 'missing', found: '1.1.40', expected: '>= 1.2.0' });
    expect(rows.bun.hint).toContain('bun.sh/install');
    expect(rows.node).toMatchObject({ status: 'missing', found: '20.19.0' });
    expect(rows.node.hint).toContain('.node-version');
    expect(rows.git).toMatchObject({ status: 'missing', found: 'not found' });
    expect(rows.git.hint).toContain('brew install git');
  });

  it('reads the wanted Node major from .node-version, falling back to the constant', () => {
    const noFile = byId(runChecks(makeCtx({ files: { '.node-version': null } })) as Row[]);
    expect(noFile.node).toMatchObject({
      status: 'ok',
      expected: `${EXPECTED.nodeMajor}.x (.node-version)`,
    });
    const pinned = byId(runChecks(makeCtx({ files: { '.node-version': 'v22.11\n' } })) as Row[]);
    expect(pinned.node).toMatchObject({ status: 'ok', expected: '22.x (.node-version)' });
  });

  it('only blocks on a Node OLDER than .node-version; newer warns (init stays usable)', () => {
    const older = byId(
      runChecks(makeCtx({ results: { 'node --version': ok('v20.11.1\n') } })) as Row[],
    );
    expect(older.node).toMatchObject({ status: 'missing', found: '20.11.1' });

    const newer = byId(
      runChecks(makeCtx({ results: { 'node --version': ok('v24.2.0\n') } })) as Row[],
    );
    expect(newer.node).toMatchObject({ status: 'warn', found: '24.2.0' });
    expect(newer.node.hint).toContain('newer than .node-version');
    // A warn never fails `bun run doctor` (or the `init` step) without --strict.
    expect(summarize([newer.node]).exitCode).toBe(0);
    expect(summarize([newer.node], { strict: true }).exitCode).toBe(1);
  });

  it('warns about foreign lockfiles with a removal hint', () => {
    const rows = byId(
      runChecks(makeCtx({ existing: ['/repo/package-lock.json', '/repo/yarn.lock'] })) as Row[],
    );
    expect(rows.lockfiles).toMatchObject({
      status: 'warn',
      found: 'package-lock.json, yarn.lock present',
      hint: 'rm package-lock.json yarn.lock && bun install  (npm/yarn/pnpm resolve a different tree)',
    });
  });

  it('warns when the pre-commit hook is missing or not lefthook', () => {
    const none = byId(runChecks(makeCtx({ files: { '.git/hooks/pre-commit': null } })) as Row[]);
    expect(none.lefthook).toMatchObject({ status: 'warn', found: 'no pre-commit hook' });
    expect(none.lefthook.hint).toContain('bunx lefthook install');
    const husky = byId(
      runChecks(
        makeCtx({ files: { '.git/hooks/pre-commit': '#!/bin/sh\n. husky.sh\n' } }),
      ) as Row[],
    );
    expect(husky.lefthook).toMatchObject({
      status: 'warn',
      found: 'pre-commit hook is not lefthook',
    });
  });

  it('EAS: warns (not fails) when the CLI is unresolvable or the major drifts from package.json', () => {
    const gone = byId(
      runChecks(makeCtx({ results: { [`${easBin} --version`]: absent } })) as Row[],
    );
    expect(gone.eas).toMatchObject({
      status: 'warn',
      found: 'not resolvable',
      hint: expect.stringContaining('bun install'),
    });
    expect(gone['eas-login']).toMatchObject({ status: 'skip', found: 'EAS CLI unavailable' });
    const old = byId(
      runChecks(
        makeCtx({ results: { [`${easBin} --version`]: ok('eas-cli/16.0.0 darwin-arm64\n') } }),
      ) as Row[],
    );
    expect(old.eas).toMatchObject({ status: 'warn', found: '16.0.0' });
  });

  it('EAS login: warns when logged out, accepts EXPO_TOKEN without calling whoami', () => {
    const out = makeCtx({
      results: { [`${easBin} whoami --non-interactive`]: failed('Not logged in\n') },
    });
    const loggedOut = byId(runChecks(out) as Row[]);
    expect(loggedOut['eas-login']).toMatchObject({ status: 'warn', found: 'logged out' });
    expect(loggedOut['eas-login'].hint).toContain('bun run eas login');
    expect(loggedOut['eas-login'].hint).toContain('EXPO_TOKEN');

    const token = makeCtx({ env: { EXPO_TOKEN: 'abc', ANDROID_HOME: '/sdk' } });
    const withToken = byId(runChecks(token) as Row[]);
    expect(withToken['eas-login']).toMatchObject({ status: 'ok', found: 'EXPO_TOKEN set' });
    expect(token.calls).not.toContain(`${easBin} whoami --non-interactive`);
  });

  it('gh: warns when missing or logged out; auth is skipped without the CLI', () => {
    const missing = byId(runChecks(makeCtx({ results: { 'gh --version': absent } })) as Row[]);
    expect(missing.gh).toMatchObject({ status: 'warn', found: 'not found' });
    expect(missing.gh.hint).toContain('brew install gh');
    expect(missing['gh-auth'].status).toBe('skip');
    const loggedOut = byId(
      runChecks(
        makeCtx({
          results: { 'gh auth status': failed('You are not logged into any GitHub hosts\n') },
        }),
      ) as Row[],
    );
    expect(loggedOut['gh-auth']).toMatchObject({
      status: 'warn',
      found: 'logged out',
      hint: expect.stringContaining('gh auth login'),
    });
  });

  it('Maestro: falls back to ~/.maestro/bin, warns below the minimum with the curl installer', () => {
    const viaHome = makeCtx({
      results: {
        'maestro --version': absent,
        '/home/me/.maestro/bin/maestro --version': ok('2.10.0\n'),
      },
      existing: ['/home/me/.maestro/bin/maestro'],
    });
    const fallback = byId(runChecks(viaHome) as Row[]);
    expect(fallback.maestro).toMatchObject({
      status: 'ok',
      found: '2.10.0 (/home/me/.maestro/bin/maestro, not on PATH)',
    });
    const old = byId(
      runChecks(makeCtx({ results: { 'maestro --version': ok('2.3.0\n') } })) as Row[],
    );
    expect(old.maestro).toMatchObject({
      status: 'warn',
      found: '2.3.0',
      expected: '>= 2.9.0 (CI pins 2.10.0)',
    });
    expect(old.maestro.hint).toContain('curl -Ls "https://get.maestro.mobile.dev" | bash');
    const none = byId(runChecks(makeCtx({ results: { 'maestro --version': absent } })) as Row[]);
    expect(none.maestro).toMatchObject({ status: 'warn', found: 'not found' });
  });

  it('Xcode: skipped off macOS, warns without simulators or below the minimum', () => {
    const linux = byId(runChecks(makeCtx({ platform: 'linux' })) as Row[]);
    expect(linux.xcode).toMatchObject({ status: 'skip', found: 'darwin only' });
    expect(linux.xcode.hint).toContain('iOS lane unavailable on linux');
    const noSims = byId(
      runChecks(
        makeCtx({ results: { 'xcrun simctl list devices available -j': ok('{"devices":{}}') } }),
      ) as Row[],
    );
    expect(noSims.xcode).toMatchObject({ status: 'warn', found: '26.6, no simulators' });
    const old = byId(
      runChecks(makeCtx({ results: { 'xcodebuild -version': ok('Xcode 15.4\n') } })) as Row[],
    );
    expect(old.xcode).toMatchObject({ status: 'warn', found: '15.4' });
    const none = byId(
      runChecks(
        makeCtx({ results: { 'xcodebuild -version': failed('xcode-select: error\n') } }),
      ) as Row[],
    );
    expect(none.xcode).toMatchObject({ status: 'warn', found: 'not found' });
    expect(none.xcode.hint).toContain('xcode-select');
  });

  it('Android: lists every missing piece, resolves adb / emulator under ANDROID_HOME', () => {
    const bare = byId(
      runChecks(
        makeCtx({ env: {}, results: { 'adb version': absent, 'emulator -version': absent } }),
      ) as Row[],
    );
    expect(bare.android).toMatchObject({
      status: 'warn',
      found: 'ANDROID_SDK_ROOT unset, adb missing, emulator missing',
    });
    expect(bare.android.hint).toContain('android-commandlinetools');
    const viaSdk = byId(
      runChecks(
        makeCtx({
          env: { ANDROID_SDK_ROOT: '/sdk' },
          existing: ['/sdk', '/sdk/platform-tools/adb', '/sdk/emulator/emulator'],
          results: {
            'adb version': absent,
            'emulator -version': absent,
            '/sdk/platform-tools/adb version': HEALTHY['adb version'],
            '/sdk/emulator/emulator -version': HEALTHY['emulator -version'],
          },
        }),
      ) as Row[],
    );
    expect(viaSdk.android).toMatchObject({ status: 'ok', found: 'adb 1.0.41, emulator 37.1.11' });
  });

  it('Java: parses stderr, understands legacy 1.8 numbering, warns below 17', () => {
    const java8 = byId(
      runChecks(
        makeCtx({ results: { 'java -version': ok('', 'java version "1.8.0_292"\n') } }),
      ) as Row[],
    );
    expect(java8.java).toMatchObject({ status: 'warn', found: '1.8.0_292', expected: 'JDK >= 17' });
    expect(java8.java.hint).toContain('temurin');
    const java17 = byId(
      runChecks(
        makeCtx({ results: { 'java -version': ok('', 'openjdk version "17.0.2" 2022-01-18\n') } }),
      ) as Row[],
    );
    expect(java17.java).toMatchObject({ status: 'ok', found: '17.0.2' });
    const none = byId(runChecks(makeCtx({ results: { 'java -version': absent } })) as Row[]);
    expect(none.java).toMatchObject({ status: 'warn', found: 'not found' });
  });

  it('a check that throws becomes a row instead of crashing the run', () => {
    const boom = [
      {
        id: 'x',
        title: 'X',
        required: false,
        lane: 'nothing',
        check: () => {
          throw new Error('kaput');
        },
      },
    ];
    const [rowX] = runChecks(makeCtx(), boom) as Row[];
    expect(rowX).toMatchObject({ status: 'warn', found: 'check failed: kaput' });
  });
});

describe('summarize', () => {
  const rows = (...statuses: Row['status'][]) =>
    statuses.map((status, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      required: status === 'missing',
      lane: `lane ${i} (detail)`,
      status,
      found: '',
      expected: '',
    }));

  it('exits 1 only for missing required tools; warnings are 0 unless --strict', () => {
    expect(summarize(rows('ok', 'ok'))).toMatchObject({
      exitCode: 0,
      message: expect.stringContaining('Toolchain complete'),
    });
    const warned = summarize(rows('ok', 'warn', 'skip'));
    expect(warned).toMatchObject({ ok: 1, warn: 1, skip: 1, missing: 0, exitCode: 0 });
    expect(warned.message).toContain('Warnings only affect optional lanes (lane 1)');
    expect(summarize(rows('ok', 'warn', 'skip'), { strict: true })).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('--strict: warnings fail (C1)'),
    });
    expect(summarize(rows('missing', 'warn'))).toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('Required: C0 — fix before continuing'),
    });
    // skip never fails, even under --strict
    expect(summarize(rows('ok', 'skip'), { strict: true }).exitCode).toBe(0);
  });
});

describe('renderTable', () => {
  it('aligns columns, marks required rows, and lists fix hints only for non-ok rows', () => {
    const table = renderTable([
      {
        id: 'bun',
        title: 'Bun',
        required: true,
        lane: 'x',
        status: 'ok',
        found: '1.3.10',
        expected: '>= 1.2.0',
      },
      {
        id: 'gh',
        title: 'GitHub CLI',
        required: false,
        lane: 'y',
        status: 'warn',
        found: 'not found',
        expected: 'any',
        hint: 'brew install gh',
      },
      {
        id: 'xcode',
        title: 'Xcode',
        required: false,
        lane: 'z',
        status: 'skip',
        found: 'darwin only',
        expected: '—',
        hint: 'iOS lane unavailable on linux',
      },
    ]);
    const lines = table.split('\n');
    expect(lines[0]).toBe('STATUS  CHECK       FOUND        EXPECTED');
    expect(lines[1]).toBe('------  ----------  -----------  --------');
    expect(lines[2]).toBe('ok      Bun *       1.3.10       >= 1.2.0');
    expect(lines[3]).toBe('warn    GitHub CLI  not found    any');
    expect(lines[4]).toBe('skip    Xcode       darwin only  —');
    expect(table).toContain(
      'Fix:\n  GitHub CLI: brew install gh\n  Xcode: iOS lane unavailable on linux',
    );
    expect(table).toContain('* required');
  });

  it('shows MISSING loudly', () => {
    const table = renderTable([
      {
        id: 'node',
        title: 'Node',
        required: true,
        lane: 'x',
        status: 'missing',
        found: 'not found',
        expected: '22.x',
        hint: 'fnm install',
      },
    ]);
    expect(table).toContain('MISSING  Node *  not found  22.x');
    expect(table).toContain('Fix:\n  Node: fnm install');
  });
});

describe('CLI surface', () => {
  it('parseArgs knows --json / --strict / --help and rejects the rest', () => {
    expect(parseArgs([])).toEqual({ json: false, strict: false, help: false });
    expect(parseArgs(['--json', '--strict'])).toMatchObject({ json: true, strict: true });
    expect(() => parseArgs(['--nope'])).toThrow('doctor: unknown argument --nope');
    expect(parseArgs(['--help'])).toMatchObject({ help: true });
  });

  it('exposes the init step (`doctor`) with an opt-out for --skip-doctor', () => {
    expect(doctorStep.id).toBe('doctor');
    expect(doctorStep.when({ args: {} })).toBe(true);
    expect(doctorStep.when({ args: { 'skip-doctor': true } })).toBe(false);
  });

  it('every check has an id, title, lane and a check function; exactly Bun, Node, git are required', () => {
    for (const c of CHECKS) {
      expect(typeof c.id).toBe('string');
      expect(typeof c.title).toBe('string');
      expect(typeof c.lane).toBe('string');
      expect(typeof c.check).toBe('function');
    }
    expect(
      CHECKS.filter((c: { required?: boolean }) => c.required).map((c: { id: string }) => c.id),
    ).toEqual(['bun', 'node', 'git']);
  });

  it('`--help` exits 0 without running anything', () => {
    const result = spawnSync(process.execPath, ['scripts/doctor.js', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: bun run doctor [--strict] [--json]');
  });
});
