// `bun run perf:flashlight` — Flashlight (bamlab) release-build performance measurement on an
// Android device or emulator that already has the e2e build installed (ADR-0007, PLAN.md D4).
// Flashlight runs ONE Maestro flow N times, profiling CPU / RAM / FPS of the app process during
// each run (`flashlight test`), then renders its scored static HTML report (`flashlight report`).
// The score itself is the reporter's business; this script only orchestrates and summarises.
//
// Used twice (docs/performance.md → Flashlight):
//   - locally, after `bun run e2e:android --keep` left the emulator running with the e2e build
//     installed: writes flashlight/results.json + flashlight/report/ and exits 1 on any problem;
//   - from the `after_maestro_tests` hook of .eas/workflows/e2e.yml with `--no-fail`, behind the
//     FLASHLIGHT repo constant (env `FLASHLIGHT=enabled|disabled`): a disabled constant, a missing
//     adb / maestro / flashlight / device, or a failed run is a notice + README.txt, never a red
//     job. Informational only — there is no budget or gate in this script.
// Node built-ins only: the maestro job checks the project out but never installs node_modules
// (the device / app-id preflight is shared with e2e:a11y through ./lib/device).
// Android only (Flashlight has no iOS profiler). Does not boot devices or install the app.
//
// Usage: bun run perf:flashlight [--platform android] [--device <serial>] [--out <dir>]
//                                [--iterations 5] [--duration 10000] [--flow <maestro flow>]
//                                [--title <text>] [--install] [--no-fail]
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, runMain } = require('./lib/args');
const { MAESTRO_HINT, appId, display, maestroBin, pickDevice, which } = require('./lib/device');
const { PLATFORM_OPTION, fail, projectRoot, run } = require('./e2e-common');

const NAME = 'perf:flashlight';
const INSTALL_URL = 'https://get.flashlight.dev';
// The installer's own target (`INSTALL_DIR="$HOME/.flashlight/bin"`, verified 2026-09-13).
const INSTALL_BIN = path.join(os.homedir(), '.flashlight', 'bin', 'flashlight');
// `curl … | bash` prints how to install; SKIP_SHELL=true keeps it from editing rc files (the
// installer exits 1 when it cannot infer the shell, e.g. no $SHELL on a CI worker, after the
// binary is already in place — so the outcome is judged by INSTALL_BIN, not the exit code).
const INSTALL_ONE_LINER = `curl -fsSL ${INSTALL_URL} | SKIP_SHELL=true bash`;

const DEFAULTS = {
  // One flow, launch → fetch → data on screen; `launchApp clearState: true` in the launch subflow
  // gives every iteration a cold-ish start. The whole workspace × 10 iterations would not fit a
  // hook's time budget, which is also why the iteration count is 5, not Flashlight's default 10.
  flow: '.maestro/flows/fetch.yaml',
  iterations: 5,
  // Profile for 10 s after the test command starts (default: until the command exits).
  duration: 10_000,
  out: 'flashlight',
};

const USAGE = `Usage: bun run perf:flashlight [--platform android] [options]   (node scripts/flashlight.js)

Runs Flashlight (https://docs.flashlight.dev) against the e2e build on an online adb device:
\`flashlight test\` drives one Maestro flow <iterations> times measuring CPU / RAM / FPS, then
\`flashlight report\` renders the scored HTML report. Writes <out>/results.json, <out>/report/ and
<out>/README.txt. Informational: no budget, no gate (ADR-0007).

Precondition: an online adb emulator / device with the e2e build installed, e.g.
  bun run e2e:android --keep && bun run perf:flashlight --platform android
Nothing is booted or installed here except, with --install, Flashlight itself.

Options:
  --platform android       default android; Flashlight has no iOS profiler, anything else is a skip
  --device <serial>        default: adb's only online device
  --out <dir>              default ${DEFAULTS.out}
  --iterations <n>         default ${DEFAULTS.iterations} (Flashlight's own default is 10)
  --duration <ms>          default ${DEFAULTS.duration}; 0 = profile until the flow exits
  --flow <path>            default ${DEFAULTS.flow}
  --title <text>           results title; default: the short git sha, else the date
  --install                install Flashlight if missing (${INSTALL_ONE_LINER}); implied on CI
  --no-fail                exit 0 on a skip or a failed run (the EAS hook mode)
  --help                   this text

Env: FLASHLIGHT=disabled skips (the repo constant in .eas/workflows/e2e.yml); unset or enabled runs.`;

const CLI = {
  name: NAME,
  usage: USAGE,
  options: {
    // Android-only tool, so `android` is the only sensible default (an explicit --platform ios
    // is still accepted and reported as a skip, which is what the EAS hook relies on).
    platform: { ...PLATFORM_OPTION, default: 'android' },
    device: { type: 'string' },
    out: { type: 'string', default: DEFAULTS.out },
    iterations: { type: 'number', integer: true, min: 0, default: DEFAULTS.iterations },
    duration: { type: 'number', integer: true, min: 0, default: DEFAULTS.duration },
    flow: { type: 'string', default: DEFAULTS.flow },
    title: { type: 'string' },
    install: { type: 'boolean' },
    'no-fail': { type: 'boolean' },
  },
};

// --- Pure functions (unit-tested in scripts/__tests__/flashlight.test.ts) --------------------

// The FLASHLIGHT repo constant reaches the hook as an env var. Unset (local use) or `enabled`
// runs; anything else is a deliberate off switch, reported as a skip.
function gateReason(value) {
  if (value === undefined || value === '' || value === 'enabled') return null;
  return `FLASHLIGHT=${value}: disabled by the repo constant (dispatch \`-F flashlight=enabled\` or flip the default in .eas/workflows/e2e.yml).`;
}

// Install without asking on CI / EAS workers; locally only with --install.
function shouldInstall({ values, env }) {
  return Boolean(values.install) || Boolean(env.CI) || Boolean(env.EAS_BUILD);
}

// Resolves the parsed CLI (scripts/lib/args.js already applied defaults and checked the numbers)
// into the one options object the driver reads.
function resolveOptions({ values, env }) {
  return {
    platform: values.platform,
    device: values.device,
    outDir: path.resolve(projectRoot, values.out),
    iterations: values.iterations,
    duration: values.duration,
    flow: values.flow,
    title: values.title,
    install: shouldInstall({ values, env }),
    noFail: Boolean(values['no-fail']),
  };
}

// The `flashlight test` invocation. `maestro` is the resolved binary (it may live outside PATH),
// `device` pins Maestro to the same emulator Flashlight profiles.
function buildTestArgs({ id, flow, iterations, duration, resultsFile, title, maestro, device }) {
  const maestroCmd = [
    maestro,
    ...(device ? ['--device', device] : []),
    'test',
    flow,
    '-e',
    `MAESTRO_APP_ID=${id}`,
  ].join(' ');
  return [
    'test',
    '--bundleId',
    id,
    '--testCommand',
    maestroCmd,
    '--iterationCount',
    String(iterations),
    ...(duration > 0 ? ['--duration', String(duration)] : []),
    '--resultsFilePath',
    resultsFile,
    '--resultsTitle',
    title,
  ];
}

function mean(numbers) {
  const valid = numbers.filter((n) => typeof n === 'number' && Number.isFinite(n));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// Reads what a results.json carries without reimplementing the score (that is the reporter's).
// Shape: { name, iterations: [{ time, status?, measures: [{ cpu: { perName }, ram?, fps? }] }] }.
function summarize(results) {
  const iterations = Array.isArray(results?.iterations) ? results.iterations : [];
  const failed = iterations.filter((it) => it?.status && it.status !== 'SUCCESS').length;
  const perIteration = (pick) =>
    mean(iterations.map((it) => mean((Array.isArray(it?.measures) ? it.measures : []).map(pick))));
  const totalCpu = (m) =>
    m?.cpu?.perName && typeof m.cpu.perName === 'object'
      ? Object.values(m.cpu.perName).reduce((a, b) => a + (Number(b) || 0), 0)
      : null;
  return {
    name: typeof results?.name === 'string' ? results.name : '',
    iterations: iterations.length,
    failed,
    averageTimeMs: mean(iterations.map((it) => it?.time)),
    averageCpuPercent: perIteration(totalCpu),
    averageRamMb: perIteration((m) => m?.ram),
    averageFps: perIteration((m) => m?.fps),
  };
}

function renderSummary(summary) {
  const fmt = (n, unit = '') => (n === null ? 'n/a' : `${Math.round(n * 10) / 10}${unit}`);
  return [
    `Flashlight: ${summary.name || '(untitled)'}`,
    `  iterations   ${summary.iterations}${summary.failed ? ` (${summary.failed} failed)` : ''}`,
    `  avg time     ${fmt(summary.averageTimeMs, ' ms')}`,
    `  avg CPU      ${fmt(summary.averageCpuPercent, ' %')} (all app threads)`,
    `  avg RAM      ${fmt(summary.averageRamMb, ' MB')}`,
    `  avg FPS      ${fmt(summary.averageFps)}`,
  ].join('\n');
}

// --- Driver -----------------------------------------------------------------------------------

function writeReadme(outDir, lines) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'README.txt'),
    [
      `Flashlight run by scripts/flashlight.js at ${new Date().toISOString()}.`,
      ...lines,
      '',
      'How to read it: docs/performance.md → Flashlight. Emulator numbers are relative — compare',
      'runs on the same worker class only (ADR-0007).',
      '',
    ].join('\n'),
  );
}

function ensureFlashlight(install) {
  const found = which('flashlight', [INSTALL_BIN]);
  if (found) return { flashlight: found };
  if (!install)
    return {
      skip: `\`flashlight\` not found. Install: ${INSTALL_ONE_LINER}   (or pass --install)`,
    };
  console.log(`${NAME}: installing Flashlight (${INSTALL_ONE_LINER})`);
  const result = spawnSync('bash', ['-c', INSTALL_ONE_LINER], {
    stdio: 'inherit',
    timeout: 300_000,
    env: { ...process.env, SKIP_SHELL: 'true' },
  });
  if (fs.existsSync(INSTALL_BIN)) return { flashlight: INSTALL_BIN };
  return {
    skip: `Flashlight install failed (exit ${result.status ?? result.error?.message ?? 'null'}); nothing at ${INSTALL_BIN}.`,
  };
}

function defaultTitle() {
  const sha = run('git', ['rev-parse', '--short', 'HEAD'], { timeout: 10_000 });
  const short = sha.status === 0 ? sha.stdout.trim() : '';
  return short || new Date().toISOString().slice(0, 10);
}

function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;
  const opts = resolveOptions({ values, env: process.env });
  const { outDir, noFail } = opts;
  // Always leave README.txt behind so an artifact upload of `outDir` never fails on a missing path.
  const skip = (reason, { exitCode = noFail ? 0 : 1 } = {}) => {
    writeReadme(outDir, ['', `Skipped: ${reason}`]);
    if (exitCode !== 0) return fail(NAME, reason);
    console.log(`${NAME}: skipped: ${reason}`);
    return 0;
  };

  const gate = gateReason(process.env.FLASHLIGHT);
  if (gate) return skip(gate, { exitCode: 0 });
  if (opts.platform !== 'android')
    return skip(`Flashlight profiles Android only (got --platform ${opts.platform}).`);
  const maestro = maestroBin();
  if (!maestro) return skip(`\`maestro\` not found. ${MAESTRO_HINT}`);
  const picked = pickDevice('android', opts.device);
  if (picked.skip) return skip(picked.skip);
  const app = appId('android');
  if (app.skip) return skip(app.skip);
  const tool = ensureFlashlight(opts.install);
  if (tool.skip) return skip(tool.skip);
  if (!fs.existsSync(path.join(projectRoot, opts.flow)))
    return skip(`flow ${opts.flow} does not exist.`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const resultsFile = path.join(outDir, 'results.json');
  const title = opts.title ?? defaultTitle();
  const testArgs = buildTestArgs({
    id: app.id,
    flow: opts.flow,
    iterations: opts.iterations,
    duration: opts.duration,
    resultsFile,
    title,
    maestro,
    device: picked.device,
  });
  console.log(`Device: ${picked.device}  MAESTRO_APP_ID=${app.id}  flashlight: ${tool.flashlight}`);
  console.log(`$ flashlight ${testArgs.join(' ')}`);
  const env = { ...process.env, ANDROID_SERIAL: picked.device };
  // Hard timeout: iterations × retries of a hung flow must not hold the job hostage.
  const test = run(tool.flashlight, testArgs, { stdio: 'inherit', timeout: 1_500_000, env });
  if (!fs.existsSync(resultsFile))
    return skip(
      `flashlight test exited ${test.status ?? test.error?.message ?? 'null'} without writing ${display(resultsFile)}.`,
    );

  // `flashlight report` also tries to `open` the page, which fails headless; the directory is
  // the verdict, not the exit code.
  const reportDir = path.join(outDir, 'report');
  const reportArgs = ['report', resultsFile, '-o', reportDir];
  console.log(`$ flashlight ${reportArgs.join(' ')}`);
  const report = run(tool.flashlight, reportArgs, { stdio: 'inherit', timeout: 300_000, env });
  const reportWritten = fs.existsSync(reportDir) && fs.readdirSync(reportDir).length > 0;
  if (!reportWritten)
    console.warn(`${NAME}: flashlight report exited ${report.status ?? 'null'}; no HTML report.`);

  let summary;
  try {
    summary = summarize(JSON.parse(fs.readFileSync(resultsFile, 'utf8')));
  } catch (err) {
    return skip(`could not read ${display(resultsFile)}: ${err.message}`);
  }
  const text = renderSummary(summary);
  console.log(`\n${text}\n`);
  writeReadme(outDir, [
    `Title: ${title}. Flow: ${opts.flow}. Device: ${picked.device}.`,
    `flashlight test exit ${test.status ?? 'null'}; report ${reportWritten ? 'written' : 'missing'}.`,
    '',
    text,
    '',
    'Compare two runs: flashlight report <a>/results.json <b>/results.json -o <dir>',
  ]);
  console.log(
    `${NAME}: results ${display(resultsFile)}; report ${reportWritten ? display(reportDir) : '(missing)'}`,
  );
  const problem =
    test.status !== 0
      ? `flashlight test exited ${test.status ?? 'null'}`
      : summary.failed
        ? `${summary.failed}/${summary.iterations} iterations failed`
        : null;
  if (!problem) return 0;
  if (noFail) {
    console.log(`${NAME}: ${problem} — exit 0 because of --no-fail.`);
    return 0;
  }
  return fail(NAME, `${problem}.`);
}

module.exports = {
  DEFAULTS,
  INSTALL_BIN,
  INSTALL_ONE_LINER,
  buildTestArgs,
  gateReason,
  renderSummary,
  resolveOptions,
  shouldInstall,
  summarize,
};

if (require.main === module) runMain(main);
