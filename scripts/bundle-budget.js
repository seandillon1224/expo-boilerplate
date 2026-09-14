#!/usr/bin/env node
/**
 * Per-platform bundle budget check (PLAN.md decision 7).
 *
 *   bun scripts/bundle-budget.js [--platform all|web|ios|android] [--dist dist-<platform>]
 *
 * `--platform all` (the default, and what `bun run budget` runs) checks every platform in
 * bundle-budget.json in turn and fails if any of them is over budget or missing its export.
 *
 * Reads the `expo export` output — `<dist>/metadata.json` (native exports) plus the
 * `_expo/static/js/<platform>` and `_expo/static/css` folders (the static web export writes
 * no metadata.json). Native bundles are Hermes bytecode (`.hbc`); they count as "js".
 * Measures raw and gzip sizes of every bundle, compares the gzip totals against
 * `bundle-budget.json`, writes `<dist>/bundle-sizes.json` for trend tracking, appends a
 * markdown table to `$GITHUB_STEP_SUMMARY` when set, and exits 1 when over budget.
 *
 * Plain Node/JS (no @types/node) so it runs under `bun` or `node` with no extra deps.
 * Exit codes follow scripts/lib/args.js: 0 within budget, 1 over budget / bad export, 2 usage.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { ScriptError, UsageError, parseArgs, runMain } = require('./lib/args');

const PLATFORMS = ['web', 'ios', 'android'];
const ROOT = path.resolve(__dirname, '..');

/**
 * The only unit `bundle-budget.json` limits may be expressed in, and the unit every number this
 * script reports (`bundle-sizes.json`, the budget comparison) is in. It is declared in the JSON
 * so a reader of the file knows what `800000` means; validated here so a future unit change has
 * to come with code that actually measures it.
 */
const UNIT = 'gzip-bytes';

const CLI = {
  name: 'bundle-budget',
  usage: `Usage: bun scripts/bundle-budget.js [--platform all|web|ios|android] [--dist <dir>]

Measures the raw and gzip size of every JS/CSS bundle in an \`expo export\` output and compares
the gzip totals against bundle-budget.json. Exits 1 when over budget.

Options:
  --platform all|web|ios|android   default all (every platform in bundle-budget.json)
  --dist <dir>                     default dist-<platform>; one platform only
  --help                           this text`,
  options: {
    platform: { type: 'string', choices: ['all', ...PLATFORMS], default: 'all' },
    dist: { type: 'string' },
  },
};

function fail(message) {
  throw new ScriptError(`bundle-budget: ${message}`);
}

/** Recursively lists files under `dir` (relative to `dist`) matching one of `exts`. */
function listFiles(dist, dir, exts) {
  const abs = path.join(dist, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(dist, rel, exts));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(rel);
  }
  return out;
}

/** JS/CSS bundle paths (relative to dist) for a platform, deduplicated and sorted by kind. */
function collectBundles(dist, platform) {
  if (!fs.existsSync(dist)) fail(`${dist} not found — run \`bun run export:${platform}\` first`);
  const js = new Set();

  // Native exports list the entry bundle in metadata.json; the static web export has none.
  const metadataPath = path.join(dist, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const bundle = metadata.fileMetadata?.[platform]?.bundle;
    if (bundle) js.add(bundle);
  }
  // Split chunks (async routes) land beside the entry bundle, so also glob the folder.
  for (const file of listFiles(dist, path.join('_expo', 'static', 'js', platform), [
    '.js',
    '.hbc',
  ])) {
    js.add(file);
  }
  const css =
    platform === 'web' ? listFiles(dist, path.join('_expo', 'static', 'css'), ['.css']) : [];

  return [
    ...[...js].sort().map((file) => ({ kind: 'js', file })),
    ...css.sort().map((file) => ({ kind: 'css', file })),
  ];
}

function measure(dist, bundle) {
  const buf = fs.readFileSync(path.join(dist, bundle.file));
  return {
    ...bundle,
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
  };
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function pad(value, width, right = false) {
  const s = String(value);
  return right ? s.padStart(width) : s.padEnd(width);
}

/** Reads bundle-budget.json and checks the declared unit is the one this script measures. */
function readBudgets() {
  const budgetsPath = path.join(ROOT, 'bundle-budget.json');
  const budgets = JSON.parse(fs.readFileSync(budgetsPath, 'utf8'));
  if (budgets.unit !== UNIT) {
    fail(
      `bundle-budget.json declares "unit": ${JSON.stringify(budgets.unit)}, but this script only ` +
        `measures ${UNIT}. Set it back to "${UNIT}" (or teach scripts/bundle-budget.js the new unit).`,
    );
  }
  return budgets;
}

/** Checks one platform. Returns 0 within budget, 1 over. */
function checkPlatform(platform, budgets, distOverride) {
  const dist = path.resolve(ROOT, distOverride ?? `dist-${platform}`);
  const budget = budgets[platform];
  if (!budget) fail(`bundle-budget.json has no "${platform}" entry`);

  const files = collectBundles(dist, platform).map((b) => measure(dist, b));
  if (files.length === 0) fail(`no JS/CSS bundles found in ${dist}`);

  const totals = { js: 0, css: 0, total: 0 };
  const rawTotals = { js: 0, css: 0, total: 0 };
  for (const f of files) {
    totals[f.kind] += f.gzip;
    totals.total += f.gzip;
    rawTotals[f.kind] += f.raw;
    rawTotals.total += f.raw;
  }

  // Per-file table.
  const fileWidth = Math.max('file'.length, ...files.map((f) => f.file.length));
  console.log(`\nbundle-budget (${platform}) — ${path.relative(ROOT, dist)}\n`);
  console.log(`${pad('file', fileWidth)}  ${pad('raw', 10, true)}  ${pad('gzip', 10, true)}`);
  for (const f of files) {
    console.log(
      `${pad(f.file, fileWidth)}  ${pad(kb(f.raw), 10, true)}  ${pad(kb(f.gzip), 10, true)}`,
    );
  }
  console.log('');

  // Budget comparison (gzip bytes).
  const checks = Object.keys(budget)
    .filter((key) => key in totals)
    .map((key) => ({
      key,
      actual: totals[key],
      limit: budget[key],
      ok: totals[key] <= budget[key],
    }));
  for (const c of checks) {
    const pct = ((c.actual / c.limit) * 100).toFixed(0);
    console.log(
      `${c.ok ? 'OK  ' : 'FAIL'} ${pad(c.key, 5)} gzip ${pad(kb(c.actual), 10, true)} / ${pad(kb(c.limit), 10, true)} (${pct}%)`,
    );
  }
  const failed = checks.filter((c) => !c.ok);

  // Machine-readable result for later trend use.
  const result = {
    platform,
    unit: UNIT,
    generatedAt: new Date().toISOString(),
    files,
    totals: { raw: rawTotals, gzip: totals },
    budget,
    ok: failed.length === 0,
  };
  fs.writeFileSync(path.join(dist, 'bundle-sizes.json'), `${JSON.stringify(result, null, 2)}\n`);

  // GitHub Actions job summary.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      `### Bundle budget — ${platform} ${failed.length === 0 ? '✅' : '❌'}`,
      '',
      '| Metric | gzip | budget | used |',
      '| --- | ---: | ---: | ---: |',
      ...checks.map(
        (c) =>
          `| ${c.key} | ${kb(c.actual)} | ${kb(c.limit)} | ${((c.actual / c.limit) * 100).toFixed(0)}% ${c.ok ? '' : '**over**'} |`,
      ),
      '',
      '<details><summary>Files</summary>',
      '',
      '| File | raw | gzip |',
      '| --- | ---: | ---: |',
      ...files.map((f) => `| \`${f.file}\` | ${kb(f.raw)} | ${kb(f.gzip)} |`),
      '',
      '</details>',
      '',
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  }

  if (failed.length > 0) {
    console.error(
      `\nbundle-budget: ${platform} is over budget (${failed.map((c) => c.key).join(', ')}). ` +
        'Trim the bundle or raise the limit in bundle-budget.json with a justification.',
    );
    return 1;
  }
  console.log(`\nbundle-budget: ${platform} within budget.`);
  return 0;
}

function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;
  const { platform, dist } = values;
  if (platform === 'all' && dist !== undefined) {
    throw new UsageError('bundle-budget: --dist needs a single --platform. Try --help.');
  }
  const budgets = readBudgets();
  const platforms = platform === 'all' ? PLATFORMS.filter((p) => budgets[p]) : [platform];
  // No early return on an over-budget platform: one run reports every overage, not just the first.
  // A missing export still throws (exit 1) — there is nothing to measure.
  let code = 0;
  for (const one of platforms) code = checkPlatform(one, budgets, dist) || code;
  return code;
}

runMain(main);
