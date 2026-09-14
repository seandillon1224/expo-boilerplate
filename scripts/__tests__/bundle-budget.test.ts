/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { UNIT, checkPlatform, collectBundles, measure, readBudgets } = require('../bundle-budget');

const ROOT = process.cwd();

type Bundle = { kind: string; file: string };
type Sizes = {
  platform: string;
  unit: string;
  ok: boolean;
  files: { kind: string; file: string; raw: number; gzip: number }[];
  totals: { raw: Record<string, number>; gzip: Record<string, number> };
  budget: Record<string, number>;
};

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-'));
});

/** Writes an `expo export`-shaped tree and returns its path. */
function makeDist(
  name: string,
  files: Record<string, string>,
  metadata?: Record<string, unknown>,
): string {
  const dist = path.join(tmp, name);
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(dist, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
  }
  if (metadata) {
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'metadata.json'), JSON.stringify(metadata));
  }
  return dist;
}

const webDist = () =>
  makeDist(`dist-web-${Math.random().toString(36).slice(2)}`, {
    'index.html': '<html>not a bundle</html>',
    'favicon.ico': 'nope',
    '_expo/static/js/web/entry-bbb.js': 'a'.repeat(5000),
    '_expo/static/js/web/chunk-aaa.js': 'b'.repeat(2000),
    '_expo/static/js/web/nested/lazy-ccc.js': 'c'.repeat(1000),
    '_expo/static/js/ios/other-platform.js': 'd'.repeat(9000),
    '_expo/static/css/style-ddd.css': 'e'.repeat(3000),
  });

const iosDist = () =>
  makeDist(
    `dist-ios-${Math.random().toString(36).slice(2)}`,
    {
      '_expo/static/js/ios/index-111.hbc': 'f'.repeat(4000),
      // CSS exists but is web-only output; a native check must not count it.
      '_expo/static/css/stray.css': 'g'.repeat(8000),
    },
    { fileMetadata: { ios: { bundle: '_expo/static/js/ios/index-111.hbc', assets: [] } } },
  );

describe('collectBundles', () => {
  it('collects js and css for web, recursing into split chunks and skipping other platforms', () => {
    expect(collectBundles(webDist(), 'web')).toEqual([
      { kind: 'js', file: path.join('_expo/static/js/web', 'chunk-aaa.js') },
      { kind: 'js', file: path.join('_expo/static/js/web', 'entry-bbb.js') },
      { kind: 'js', file: path.join('_expo/static/js/web/nested', 'lazy-ccc.js') },
      { kind: 'css', file: path.join('_expo/static/css', 'style-ddd.css') },
    ] satisfies Bundle[]);
  });

  it('counts the Hermes bundle once when metadata.json and the folder glob agree', () => {
    // The entry bundle is listed in metadata.json *and* found by the glob — it must not be double counted.
    expect(collectBundles(iosDist(), 'ios')).toEqual([
      { kind: 'js', file: '_expo/static/js/ios/index-111.hbc' },
    ]);
  });

  it('picks up a bundle that only metadata.json knows about', () => {
    const dist = makeDist(
      'dist-meta-only',
      { 'bundles/ios-deadbeef.hbc': 'h'.repeat(100) },
      { fileMetadata: { ios: { bundle: 'bundles/ios-deadbeef.hbc' } } },
    );
    expect(collectBundles(dist, 'ios')).toEqual([{ kind: 'js', file: 'bundles/ios-deadbeef.hbc' }]);
  });

  it('fails with an actionable message when the export directory is missing', () => {
    expect(() => collectBundles(path.join(tmp, 'nope'), 'android')).toThrow(
      /bundle-budget: .*nope not found — run `bun run export:android` first/,
    );
  });
});

describe('measure', () => {
  it('reports the raw byte length and a smaller gzip length', () => {
    const dist = makeDist('dist-measure', { 'app.js': 'x'.repeat(10_000) });
    const measured = measure(dist, { kind: 'js', file: 'app.js' });
    expect(measured.raw).toBe(10_000);
    expect(measured.gzip).toBe(zlib.gzipSync(Buffer.from('x'.repeat(10_000)), { level: 9 }).length);
    expect(measured.gzip).toBeLessThan(measured.raw);
    expect(measured.kind).toBe('js');
  });
});

describe('readBudgets', () => {
  it('accepts the checked-in bundle-budget.json', () => {
    const budgets = readBudgets();
    expect(budgets.unit).toBe(UNIT);
    for (const platform of ['web', 'ios', 'android']) {
      expect(typeof budgets[platform].js).toBe('number');
    }
  });

  it('refuses a budget file declaring a unit this script does not measure', () => {
    const file = path.join(tmp, 'wrong-unit.json');
    fs.writeFileSync(file, JSON.stringify({ unit: 'kB', web: { js: 100 } }));
    expect(() => readBudgets(file)).toThrow(/declares "unit": "kB".*only measures gzip-bytes/s);
  });
});

describe('checkPlatform', () => {
  const budgets = { unit: UNIT, web: { js: 1_000_000, css: 10_000, total: 1_010_000 } };
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  const sizes = (dist: string): Sizes =>
    JSON.parse(fs.readFileSync(path.join(dist, 'bundle-sizes.json'), 'utf8'));

  it('returns 0 and writes bundle-sizes.json when within budget', () => {
    const dist = webDist();
    expect(checkPlatform('web', budgets, dist)).toBe(0);

    const result = sizes(dist);
    expect(result).toMatchObject({ platform: 'web', unit: UNIT, ok: true });
    expect(result.files).toHaveLength(4);
    // Totals are the sum of the per-file gzip sizes, split by kind.
    const js = result.files.filter((f) => f.kind === 'js');
    const css = result.files.filter((f) => f.kind === 'css');
    expect(result.totals.gzip.js).toBe(js.reduce((n, f) => n + f.gzip, 0));
    expect(result.totals.gzip.css).toBe(css.reduce((n, f) => n + f.gzip, 0));
    expect(result.totals.gzip.total).toBe(result.totals.gzip.js + result.totals.gzip.css);
    expect(result.totals.raw.total).toBe(11_000); // 5000 + 2000 + 1000 + 3000
    expect(result.totals.gzip.total).toBeLessThan(result.totals.raw.total);
  });

  it('returns 1, names the over-budget metrics and still writes the sizes file', () => {
    const dist = webDist();
    expect(checkPlatform('web', { unit: UNIT, web: { js: 10, css: 10_000 } }, dist)).toBe(1);
    expect(error.mock.calls.join('\n')).toMatch(/web is over budget \(js\)/);
    expect(error.mock.calls.join('\n')).not.toMatch(/css/);
    expect(sizes(dist).ok).toBe(false);
  });

  it('only checks the keys the budget lists', () => {
    const dist = iosDist();
    // No `css` or `total` key for ios: a huge js total is the only thing compared.
    expect(checkPlatform('ios', { unit: UNIT, ios: { js: 1_000_000 } }, dist)).toBe(0);
    const result = sizes(dist);
    expect(Object.keys(result.budget)).toEqual(['js']);
    expect(result.totals.gzip.css).toBe(0);
    expect(result.files).toHaveLength(1);
  });

  it('fails when the budget file has no entry for the platform', () => {
    expect(() => checkPlatform('android', { unit: UNIT, web: { js: 1 } }, webDist())).toThrow(
      /no "android" entry/,
    );
  });

  it('fails when the export contains no JS/CSS bundle at all', () => {
    const dist = makeDist('dist-empty', { 'index.html': '<html></html>' });
    expect(() => checkPlatform('web', budgets, dist)).toThrow(/no JS\/CSS bundles found/);
  });

  it('appends a markdown table to $GITHUB_STEP_SUMMARY when set', () => {
    const summary = path.join(tmp, 'step-summary.md');
    const previous = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      checkPlatform('web', { unit: UNIT, web: { js: 10 } }, webDist());
    } finally {
      if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous;
    }
    const written = fs.readFileSync(summary, 'utf8');
    expect(written).toContain('### Bundle budget — web ❌');
    expect(written).toContain('| js |');
    expect(written).toContain('**over**');
  });
});

describe('CLI', () => {
  function runCli(args: string[]) {
    const result = spawnSync(process.execPath, ['scripts/bundle-budget.js', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it('checks one platform against a --dist export', () => {
    const dist = iosDist();
    const { status, output } = runCli(['--platform', 'ios', '--dist', dist]);
    expect(status).toBe(0);
    expect(output).toContain('bundle-budget: ios within budget.');
    expect(output).toContain('index-111.hbc');
  });

  it('exits 1 when the export is missing', () => {
    const { status, output } = runCli(['--platform', 'web', '--dist', path.join(tmp, 'absent')]);
    expect(status).toBe(1);
    expect(output).toContain('run `bun run export:web` first');
  });

  it('rejects --dist without a single --platform (exit 2)', () => {
    const { status, output } = runCli(['--dist', 'dist-web']);
    expect(status).toBe(2);
    expect(output).toContain('--dist needs a single --platform');
  });

  it('rejects an unknown platform (exit 2)', () => {
    const { status, output } = runCli(['--platform', 'windows']);
    expect(status).toBe(2);
    expect(output).toContain('--platform must be one of all|web|ios|android');
  });

  it('prints usage for --help and exits 0', () => {
    const { status, output } = runCli(['--help']);
    expect(status).toBe(0);
    expect(output).toContain('Usage: bun scripts/bundle-budget.js');
  });
});
