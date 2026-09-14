/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { ScriptError, UsageError, parseArgs, runMain } = require('../lib/args');

type Options = Record<string, unknown>;

const cli = (options: Options, extra: Options = {}) => ({
  name: 'demo',
  usage: 'Usage: demo [--flag]',
  options,
  ...extra,
});

describe('parseArgs', () => {
  it('reads --flag value, --flag=value and -x value the same way', () => {
    const spec = cli({
      platform: { type: 'string', short: 'p' },
      out: { type: 'string' },
      keep: { type: 'boolean' },
    });
    expect(parseArgs(['--platform', 'ios', '--out=/tmp/x', '--keep'], spec).values).toEqual({
      platform: 'ios',
      out: '/tmp/x',
      keep: true,
    });
    expect(parseArgs(['-p', 'android'], spec).values).toMatchObject({ platform: 'android' });
  });

  it('gives every boolean a value and every option its default', () => {
    const { values } = parseArgs([], cli({ keep: { type: 'boolean' }, out: { type: 'string' } }));
    expect(values).toEqual({ keep: false, out: undefined });
    expect(parseArgs([], cli({ dist: { type: 'string', default: 'dist-web' } })).values.dist).toBe(
      'dist-web',
    );
  });

  it('never swallows the next argument as a value', () => {
    // The old e2e-common parser turned `--keep --device` into `{ keep: '--device' }`.
    const spec = cli({ keep: { type: 'boolean' }, device: { type: 'string' } });
    expect(parseArgs(['--keep', '--device', 'booted'], spec).values).toEqual({
      keep: true,
      device: 'booted',
    });
  });

  it('coerces and validates numbers', () => {
    const spec = cli({ days: { type: 'number', integer: true, min: 1 } });
    expect(parseArgs(['--days', '14'], spec).values.days).toBe(14);
    expect(() => parseArgs(['--days', '0'], spec)).toThrow(/--days must be >= 1/);
    expect(() => parseArgs(['--days', 'many'], spec)).toThrow(/--days must be an integer/);
    expect(() => parseArgs(['--days', '1.5'], spec)).toThrow(/--days must be an integer/);
    expect(parseArgs(['--rate', '1.5'], cli({ rate: { type: 'number' } })).values.rate).toBe(1.5);
  });

  it('enforces choices and required options', () => {
    const spec = cli({ platform: { type: 'string', choices: ['ios', 'android'], required: true } });
    expect(() => parseArgs(['--platform', 'web'], spec)).toThrow(
      /--platform must be one of ios\|android/,
    );
    expect(() => parseArgs([], spec)).toThrow(/--platform is required/);
  });

  it('collects repeatable options', () => {
    const spec = cli({ only: { type: 'string', multiple: true } });
    expect(parseArgs(['--only', 'a', '--only=b'], spec).values.only).toEqual(['a', 'b']);
    expect(parseArgs([], spec).values.only).toBeUndefined();
  });

  it('maps a deprecated alias onto its new name and says so', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const spec = cli({
      'quarantine-only': { type: 'boolean' },
      'include-quarantine': {
        type: 'boolean',
        aliasFor: 'quarantine-only',
        deprecated: 'renamed to --quarantine-only',
      },
    });
    expect(parseArgs(['--include-quarantine'], spec).values).toEqual({ 'quarantine-only': true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('--quarantine-only'));
    expect(parseArgs([], spec).values).toEqual({ 'quarantine-only': false });
    warn.mockRestore();
  });

  it('prints the usage on --help / -h and reports it to the caller', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    for (const flag of ['--help', '-h']) {
      const parsed = parseArgs([flag], cli({ keep: { type: 'boolean' } }));
      expect(parsed.help).toBe(true);
    }
    expect(log).toHaveBeenCalledWith('Usage: demo [--flag]');
    log.mockRestore();
  });

  it('accepts a usage function (doctor)', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    parseArgs(['--help'], cli({}, { usage: () => 'lazy usage' }));
    expect(log).toHaveBeenCalledWith('lazy usage');
    log.mockRestore();
  });

  it('throws a UsageError (exit 2) for every bad command line', () => {
    const spec = cli({ out: { type: 'string' }, keep: { type: 'boolean' } });
    for (const argv of [['--bogus'], ['--out'], ['--keep=yes'], ['positional']]) {
      let thrown: Error | null = null;
      try {
        parseArgs(argv, spec);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown).toBeInstanceOf(UsageError);
      expect((thrown as unknown as { code: number }).code).toBe(2);
      expect(thrown?.message).toMatch(/^demo: /);
    }
    expect(() => parseArgs(['--bogus'], spec)).toThrow(/unknown argument --bogus/);
    expect(() => parseArgs(['--out'], spec)).toThrow(/--out needs a value/);
    expect(() => parseArgs(['--keep=yes'], spec)).toThrow(/--keep does not take a value/);
    expect(() => parseArgs(['x'], spec)).toThrow(/unexpected argument/);
  });

  it('accepts positionals only when the script asks for them', () => {
    const spec = cli({}, { allowPositionals: true });
    expect(parseArgs(['a', 'b'], spec).positionals).toEqual(['a', 'b']);
  });
});

describe('runMain', () => {
  const exitCode = () => process.exitCode;
  let error: jest.SpyInstance;

  beforeEach(() => {
    process.exitCode = undefined;
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.exitCode = 0;
    error.mockRestore();
  });

  it('uses the code main returns (0 when it returns nothing)', () => {
    runMain(() => 1, []);
    expect(exitCode()).toBe(1);
    runMain(() => undefined, []);
    expect(exitCode()).toBe(0);
  });

  it('prints a UsageError as exit 2 and a ScriptError as its own code', () => {
    runMain(() => {
      throw new UsageError('demo: nope');
    }, []);
    expect(exitCode()).toBe(2);
    expect(error).toHaveBeenCalledWith('demo: nope');

    runMain(() => {
      throw new ScriptError('demo: over budget');
    }, []);
    expect(exitCode()).toBe(1);
  });

  it('prints anything else as a stack trace with exit 1', () => {
    runMain(() => {
      throw new TypeError('boom');
    }, []);
    expect(exitCode()).toBe(1);
    expect(error.mock.calls[0][0]).toMatch(/TypeError: boom/);
  });

  it('awaits an async main', async () => {
    runMain(async () => 3, []);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exitCode()).toBe(3);

    runMain(async () => {
      throw new ScriptError('demo: async failure', 2);
    }, []);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exitCode()).toBe(2);
  });
});
