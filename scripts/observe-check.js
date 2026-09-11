#!/usr/bin/env node
/**
 * EAS Observe startup-TTI check (PLAN.md decision 7, docs/observe.md).
 *
 *   bun run observe:check [--platform ios|android] [--days 7] [--version 1.2.0]
 *                         [--update-id <id>] [--project-id <uuid>] [--strict]
 *   bun run observe:check --input <saved metrics-summary json>   # offline, for tests / dry runs
 *
 * Runs `eas observe:metrics-summary --metric tti --json` for the window, then compares each
 * app-version row per platform against `observe-budget.json` (milliseconds per statistic).
 *
 * Exit codes: 1 when any evaluated row breaches a threshold or the CLI fails for a reason the
 * operator must fix; 0 otherwise. Rows below `minSamples` are reported as insufficient data and
 * pass. Without a usable EAS session (no `EXPO_TOKEN` and not logged in), without a linked
 * project, on a plan that does not include Observe, or with no data yet, the check SKIPS with a
 * notice and exits 0 so the template stays green before Observe is configured — `--strict`
 * (or `OBSERVE_CHECK_STRICT=1`) turns every skip into a failure once the check is used as a gate.
 *
 * Plain Node/JS (no @types/node) so it runs under `bun` or `node` with no extra deps.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BUDGET_FILE = 'observe-budget.json';
const PLATFORMS = ['ios', 'android'];
/** Statistics `observe:metrics-summary` can return; the budget may key any of these. */
const STATS = ['min', 'median', 'max', 'average', 'p80', 'p90', 'p99'];
const METRIC_NAMES = {
  tti: 'expo.app_startup.tti',
  ttr: 'expo.app_startup.ttr',
  cold_launch: 'expo.app_startup.cold_launch_time',
  warm_launch: 'expo.app_startup.warm_launch_time',
  bundle_load: 'expo.app_startup.bundle_load_time',
  update_download: 'expo.updates.download_time',
  nav_cold_ttr: 'expo.navigation.cold_ttr',
  nav_warm_ttr: 'expo.navigation.warm_ttr',
  nav_tti: 'expo.navigation.tti',
};

function parseArgs(argv) {
  const args = {
    platform: undefined,
    days: 7,
    version: undefined,
    updateId: undefined,
    projectId: process.env.EAS_PROJECT_ID || undefined,
    input: undefined,
    budget: BUDGET_FILE,
    strict: process.env.OBSERVE_CHECK_STRICT === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq < 0 ? arg : arg.slice(0, eq);
    const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    const value = () => {
      if (inline !== undefined) return inline;
      i += 1;
      if (argv[i] === undefined) throw new Error(`${flag} needs a value`);
      return argv[i];
    };
    switch (flag) {
      case '--platform':
        args.platform = value();
        break;
      case '--days':
        args.days = Number(value());
        break;
      case '--version':
        args.version = value();
        break;
      case '--update-id':
        args.updateId = value();
        break;
      case '--project-id':
        args.projectId = value();
        break;
      case '--input':
        args.input = value();
        break;
      case '--budget':
        args.budget = value();
        break;
      case '--strict':
        args.strict = true;
        break;
      case '--dry-run':
        // Alias kept for muscle memory: a dry run is an --input run; the flag alone changes nothing.
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (args.platform !== undefined && !PLATFORMS.includes(args.platform)) {
    throw new Error(`--platform must be one of ${PLATFORMS.join('|')}; got "${args.platform}"`);
  }
  if (!Number.isInteger(args.days) || args.days < 1) {
    throw new Error(`--days must be a positive integer; got "${args.days}"`);
  }
  return args;
}

function loadBudget(file) {
  const budget = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'));
  if (budget.unit !== 'ms') throw new Error(`${file}: "unit" must be "ms"`);
  if (!METRIC_NAMES[budget.metric]) {
    throw new Error(`${file}: "metric" must be one of ${Object.keys(METRIC_NAMES).join('|')}`);
  }
  if (!Number.isInteger(budget.minSamples) || budget.minSamples < 1) {
    throw new Error(`${file}: "minSamples" must be a positive integer`);
  }
  for (const platform of PLATFORMS) {
    const limits = budget[platform] ?? {};
    for (const [stat, limit] of Object.entries(limits)) {
      if (!STATS.includes(stat)) throw new Error(`${file}: ${platform}.${stat} is not a statistic`);
      if (typeof limit !== 'number' || limit <= 0) {
        throw new Error(`${file}: ${platform}.${stat} must be a positive number of ms`);
      }
    }
  }
  return budget;
}

/**
 * Pure comparison of a `metrics-summary --json` report against the budget. Returns one row per
 * (version, platform) that survived the filters, each with `status`: 'ok' | 'breach' |
 * 'insufficient' | 'no-limits', plus the list of breached statistics. Exported for tests.
 */
function evaluate(report, budget, filters = {}) {
  const metricName = METRIC_NAMES[budget.metric];
  const rows = [];
  for (const entry of report.versions ?? []) {
    const platform = String(entry.platform ?? '').toLowerCase();
    if (!PLATFORMS.includes(platform)) continue;
    if (filters.platform && platform !== filters.platform) continue;
    if (filters.version && entry.appVersion !== filters.version) continue;
    if (filters.updateId && !(entry.updateIds ?? []).includes(filters.updateId)) continue;

    const stats = entry.metrics?.[metricName];
    if (!stats) continue;
    const samples = Number(stats.eventCount ?? 0);
    const limits = budget[platform] ?? {};
    const checks = Object.entries(limits).map(([stat, limitMs]) => {
      const seconds = stats[stat];
      const actualMs = typeof seconds === 'number' ? Math.round(seconds * 1000) : undefined;
      return { stat, actualMs, limitMs, ok: actualMs === undefined || actualMs <= limitMs };
    });
    const breaches = checks.filter((c) => !c.ok);

    let status = 'ok';
    if (Object.keys(limits).length === 0) status = 'no-limits';
    else if (samples < budget.minSamples) status = 'insufficient';
    else if (breaches.length > 0) status = 'breach';

    rows.push({
      platform,
      appVersion: String(entry.appVersion ?? '?'),
      buildNumbers: entry.buildNumbers ?? [],
      updateIds: entry.updateIds ?? [],
      samples,
      checks,
      breaches,
      status,
    });
  }
  rows.sort(
    (a, b) => a.platform.localeCompare(b.platform) || a.appVersion.localeCompare(b.appVersion),
  );
  return rows;
}

function formatRow(row) {
  const values = row.checks
    .map(
      (c) => `${c.stat} ${c.actualMs === undefined ? 'n/a' : `${c.actualMs} ms`}/${c.limitMs} ms`,
    )
    .join(', ');
  const label = `${row.platform} ${row.appVersion}${row.buildNumbers.length ? ` (${row.buildNumbers.join(', ')})` : ''}`;
  switch (row.status) {
    case 'breach':
      return `FAIL ${label}: ${values} — ${row.samples} samples; over on ${row.breaches.map((c) => c.stat).join(', ')}`;
    case 'insufficient':
      return `SKIP ${label}: ${row.samples} samples (< minSamples) — ${values}`;
    case 'no-limits':
      return `SKIP ${label}: no thresholds for ${row.platform} in the budget — ${row.samples} samples`;
    default:
      return `OK   ${label}: ${values} — ${row.samples} samples`;
  }
}

/** Runs the repo-pinned eas-cli; returns { status, stdout, stderr }. Never throws. */
function runEas(args) {
  const result = spawnSync('bun', ['run', 'eas', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Why the CLI could not answer, when it is a setup gap rather than a bug: 'auth' | 'project' | 'plan' | null. */
function classifySkip(text) {
  if (/not logged in|EXPO_TOKEN|log in|logged out|unauthori[sz]ed|authentication/i.test(text))
    return 'auth';
  if (/project ?id|projectId|not linked|no project|eas init/i.test(text)) return 'project';
  if (
    /PLAN_UPGRADE|NOT_AVAILABLE_IN_FREE_TIER|upgrade your plan|not available on your plan/i.test(
      text,
    )
  )
    return 'plan';
  return null;
}

/** Fetches the report; returns { report } or { skip: reason } or { error: message }. */
function fetchReport(args, budget) {
  if (!process.env.EXPO_TOKEN) {
    const who = runEas(['whoami', '--non-interactive']);
    if (who.status !== 0) {
      return {
        skip: 'no EAS session: set EXPO_TOKEN (EAS robot token) or run `bun run eas login`',
      };
    }
  }
  const cli = ['observe:metrics-summary', '--metric', budget.metric, '--days', String(args.days)];
  for (const stat of ['median', 'p90', 'eventCount']) cli.push('--stat', stat);
  for (const stat of STATS) {
    if (budget.ios?.[stat] !== undefined || budget.android?.[stat] !== undefined) {
      if (!['median', 'p90'].includes(stat)) cli.push('--stat', stat);
    }
  }
  if (args.platform) cli.push('--platform', args.platform);
  if (args.projectId) cli.push('--project-id', args.projectId);
  cli.push('--json', '--non-interactive');
  console.log(`observe-check: bun run eas ${cli.join(' ')}`);

  const result = runEas(cli);
  if (result.status !== 0) {
    const text = `${result.stderr}\n${result.stdout}`;
    const reason = classifySkip(text);
    if (reason === 'auth')
      return { skip: 'EAS rejected the session (EXPO_TOKEN missing or invalid)' };
    if (reason === 'project')
      return { skip: 'no EAS project id (EAS_PROJECT_ID in app.config.ts / --project-id)' };
    if (reason === 'plan') return { skip: 'EAS Observe is not included in this account plan' };
    return { error: `eas-cli exited ${result.status}:\n${text.trim()}` };
  }
  const start = result.stdout.indexOf('{');
  if (start < 0) return { error: `eas-cli printed no JSON:\n${result.stdout.trim()}` };
  try {
    return { report: JSON.parse(result.stdout.slice(start)) };
  } catch (e) {
    return { error: `could not parse eas-cli output: ${e.message}` };
  }
}

function summaryMarkdown(rows, budget, window) {
  const icon = { ok: '✅', breach: '❌', insufficient: 'ℹ️', 'no-limits': 'ℹ️' };
  return [
    `### EAS Observe — ${budget.metric} ${window}`,
    '',
    '| Platform | Version | Samples | Stats (actual / budget, ms) | Status |',
    '| --- | --- | ---: | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.platform} | ${r.appVersion} | ${r.samples} | ${r.checks.map((c) => `${c.stat} ${c.actualMs ?? 'n/a'} / ${c.limitMs}`).join('<br>')} | ${icon[r.status]} ${r.status} |`,
    ),
    '',
  ].join('\n');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`observe-check: ${e.message}`);
    return 1;
  }
  const budget = loadBudget(args.budget);
  const skip = (message) => {
    if (args.strict) {
      console.error(`observe-check: ${message} — failing because --strict is set.`);
      return 1;
    }
    console.log(`observe-check: ${message} — skipping (docs/observe.md → Troubleshooting).`);
    return 0;
  };

  let report;
  let window;
  if (args.input) {
    report = JSON.parse(fs.readFileSync(path.resolve(ROOT, args.input), 'utf8'));
    window = `from ${args.input}`;
  } else {
    const fetched = fetchReport(args, budget);
    if (fetched.skip) return skip(fetched.skip);
    if (fetched.error) {
      console.error(`observe-check: ${fetched.error}`);
      return 1;
    }
    report = fetched.report;
    window = `over the last ${args.days} day(s)`;
  }

  const rows = evaluate(report, budget, args);
  const scope = [
    args.platform && `platform=${args.platform}`,
    args.version && `version=${args.version}`,
    args.updateId && `update=${args.updateId}`,
  ]
    .filter(Boolean)
    .join(' ');
  console.log(`\nobserve-check: ${budget.metric} ${window}${scope ? ` (${scope})` : ''}\n`);
  if (rows.length === 0) {
    return skip(`no ${budget.metric} samples in the window${scope ? ` for ${scope}` : ''}`);
  }
  for (const row of rows) (row.status === 'breach' ? console.error : console.log)(formatRow(row));

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${summaryMarkdown(rows, budget, window)}\n`,
    );
  }

  const evaluated = rows.filter((r) => r.status === 'ok' || r.status === 'breach');
  const breaches = rows.filter((r) => r.status === 'breach');
  if (breaches.length > 0) {
    console.error(
      `\nobserve-check: ${breaches.length} of ${evaluated.length} version row(s) over the ${budget.metric} budget. ` +
        'Find the slow sessions with `bun run eas observe:metrics tti --sort slowest`, or raise the limit in observe-budget.json with a justification.',
    );
    return 1;
  }
  if (evaluated.length === 0) {
    return skip(`every row has fewer than ${budget.minSamples} samples (insufficient data)`);
  }
  console.log(
    `\nobserve-check: ${evaluated.length} version row(s) within the ${budget.metric} budget.`,
  );
  return 0;
}

module.exports = { evaluate, loadBudget, parseArgs, classifySkip, METRIC_NAMES };

if (require.main === module) process.exitCode = main();
