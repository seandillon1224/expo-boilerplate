// `bun run e2e:a11y` — screen-reader-output audit of Maestro's accessibility tree (ADR-0005,
// PLAN.md D6). Maestro cannot drive VoiceOver / TalkBack, so instead of a "screen reader on" flow
// this script drives the app to each screen, dumps `maestro hierarchy` (what the platform's
// accessibility API exposes, i.e. what a screen reader would read) and checks every interactive
// element against three rules:
//   1. it has a non-empty label (`accessibilityText`, else `text`, else `title`)
//   2. the label is not the raw testID (a `resource-id` leaking to the screen reader)
//   3. no two interactive elements on the same screen share a label
// "Interactive" is derived from source the same way eslint-rules/rules/require-testid.js does:
// every literal `testID` on a Pressable / Touchable* / Button / TextInput / Switch / Link in
// src/**/*.tsx. Dynamic testIDs (`testID={…}`) cannot be resolved statically and are listed as
// unaudited in the report. Containers and non-interactive testIDs are ignored.
//
// Used twice (docs/native-e2e.md → Failure artifacts):
//   - locally, after `bun run e2e:ios --keep` / `e2e:android --keep` left the device running with
//     the e2e build installed: writes maestro-<platform>/a11y/ and exits 1 on any finding;
//   - from the `after_maestro_tests` hook of .eas/workflows/e2e.yml with `--no-fail`, where an
//     unreachable maestro / device is a skip notice, never a red job.
// Node built-ins only: the maestro job checks the project out but never installs node_modules
// (./e2e-common is built-ins only too). Does not boot devices or install apps.
//
// Usage: bun run e2e:a11y --platform ios|android [--device <udid|serial>] [--out <dir>] [--no-fail]
// `--platform` is required: this audits a device someone else booted, so a default would guess.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseArgs, runMain } = require('./lib/args');
const { PLATFORM_OPTION, fail, projectRoot, run, runJson } = require('./e2e-common');

const NAME = 'e2e:a11y';

// Repo-relative for the default `maestro-<p>/a11y`; absolute when --out points elsewhere.
function display(dir) {
  const rel = path.relative(projectRoot, dir);
  return rel && !rel.startsWith('..') ? rel : dir;
}
const USAGE = `Usage: bun run e2e:a11y --platform ios|android [options]   (node scripts/a11y-audit.js)

Audits what a screen reader would read on each screen (ADR-0005): runs the nav subflow in
.maestro/subflows/a11y/<screen>.yaml, dumps \`maestro hierarchy\`, and checks every interactive
element (literal testIDs on pressables / inputs in src/**/*.tsx) for a non-empty label that is
not the testID and is unique on the screen. Writes <out>/<screen>.json + <out>/report.json.

Precondition: a booted simulator / online adb device with the e2e build installed, e.g.
  bun run e2e:ios --keep && bun run e2e:a11y --platform ios
(or install e2e/builds/<platform>/repacked.app|apk yourself). Nothing is booted or installed here.

Options:
  --platform ios|android   required (there is no sensible default: it must match the booted device)
  --device <udid|serial>   default: the booted simulator / adb's only online device
  --out <dir>              default maestro-<platform>/a11y
  --no-fail                exit 0 on findings, nav failures and a missing maestro / device
                           (the EAS hook mode: prints a skip notice instead of failing)
  --help                   this text`;

const CLI = {
  name: NAME,
  usage: USAGE,
  options: {
    // Required, not defaulted: this script audits whatever is already booted, so guessing `ios`
    // on an Android-only box turned a missing flag into a confusing skip.
    platform: { ...PLATFORM_OPTION, required: true },
    device: { type: 'string' },
    out: { type: 'string' },
    'no-fail': { type: 'boolean' },
  },
};

// Screens in navigation order; each subflow lands on the screen and asserts its container id.
const SCREENS = [
  { screen: 'home', flow: '.maestro/subflows/a11y/home.yaml' },
  { screen: 'settings', flow: '.maestro/subflows/a11y/settings.yaml' },
  { screen: 'fetch', flow: '.maestro/subflows/a11y/fetch.yaml' },
  { screen: 'updates', flow: '.maestro/subflows/a11y/updates.yaml' },
];

// Mirrors DEFAULT_ELEMENTS in eslint-rules/rules/require-testid.js (Pressable / Link are the
// @/tw wrappers; NativeTabs.Trigger is deliberately absent, the tab bar is platform UI).
const INTERACTIVE_ELEMENTS = [
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'Button',
  'TextInput',
  'Switch',
  'Link',
];

// --- Pure functions (unit-tested in scripts/__tests__/a11y-audit.test.ts) --------------------

// Returns the end index (exclusive) of the JSX opening element that starts at `start`
// (`<Name`), skipping `>` inside braces, strings and template literals (`onPress={() => …}`).
function findTagEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return -1;
}

// Scans one TSX source for the interactive elements above and their testIDs.
// `literal`: string testIDs; `dynamic`: `testID={expr}` and spread-only elements, which the
// audit cannot resolve — reported as unaudited rather than silently skipped.
function extractInteractiveIds(source, elements = INTERACTIVE_ELEMENTS) {
  const literal = [];
  const dynamic = [];
  const opener = new RegExp(`<(?:[A-Za-z_$][\\w$]*\\.)*(${elements.join('|')})(?=[\\s/>])`, 'g');
  let match;
  while ((match = opener.exec(source)) !== null) {
    const end = findTagEnd(source, match.index);
    if (end === -1) break;
    const attrs = source.slice(match.index + match[0].length, end);
    opener.lastIndex = end;
    const element = match[1];
    const literalId = attrs.match(
      /\btestID=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)')\s*\})/,
    );
    if (literalId) {
      literal.push(literalId[1] ?? literalId[2] ?? literalId[3] ?? literalId[4]);
      continue;
    }
    const dynamicId = attrs.match(/\btestID=\{([^]*?)\}\s*(?=[\w{/>]|$)/);
    if (dynamicId) dynamic.push({ element, expression: `testID={${dynamicId[1].trim()}}` });
    else if (/\{\s*\.\.\./.test(attrs)) dynamic.push({ element, expression: '{...spread}' });
  }
  return { literal, dynamic };
}

function listTsx(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === '__perf__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listTsx(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// The interactive set for the whole app: `ids` (Set of literal testIDs) + `dynamic` (strings
// naming file + element + expression, for the report).
function collectInteractiveIds(srcDir = path.join(projectRoot, 'src')) {
  const ids = new Set();
  const dynamic = [];
  for (const file of listTsx(srcDir).sort()) {
    const found = extractInteractiveIds(fs.readFileSync(file, 'utf8'));
    for (const id of found.literal) ids.add(id);
    for (const d of found.dynamic)
      dynamic.push(`${path.relative(projectRoot, file)}: <${d.element} ${d.expression}>`);
  }
  return { ids, dynamic };
}

// `maestro hierarchy` prints a JSON tree of { attributes, children }; some versions prefix it
// with log lines, so parse from the first `{`.
function parseHierarchy(text) {
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object in maestro hierarchy output');
  return JSON.parse(text.slice(start));
}

function flattenNodes(tree, out = []) {
  if (!tree || typeof tree !== 'object') return out;
  if (tree.attributes) out.push(tree.attributes);
  for (const child of tree.children ?? []) flattenNodes(child, out);
  return out;
}

// What the screen reader would announce: iOS puts the merged child text in accessibilityText,
// Android may carry it in `text`; `title` is the last resort.
function labelOf(attrs) {
  for (const key of ['accessibilityText', 'text', 'title']) {
    const value = typeof attrs[key] === 'string' ? attrs[key].trim() : '';
    if (value) return value;
  }
  return '';
}

// Applies the three rules to one screen's hierarchy. Nodes sharing a resource-id (a container
// and the child the platform merged into it) count as one element carrying the first non-empty
// label, so a merged label is never reported as missing.
function auditScreen(tree, interactiveIds) {
  const byId = new Map();
  for (const attrs of flattenNodes(tree)) {
    const id = typeof attrs['resource-id'] === 'string' ? attrs['resource-id'] : '';
    if (!id || !interactiveIds.has(id)) continue;
    const label = labelOf(attrs);
    const hint = typeof attrs.hintText === 'string' ? attrs.hintText.trim() : '';
    const existing = byId.get(id);
    if (!existing) byId.set(id, { id, label, hint, problems: [] });
    else {
      if (!existing.label && label) existing.label = label;
      if (!existing.hint && hint) existing.hint = hint;
    }
  }
  const elements = [...byId.values()];
  const byLabel = new Map();
  for (const el of elements) {
    if (!el.label) el.problems.push('empty label: the screen reader has nothing to announce');
    else if (el.label === el.id) el.problems.push('label is the raw testID');
    if (el.label) byLabel.set(el.label, [...(byLabel.get(el.label) ?? []), el.id]);
  }
  for (const [label, ids] of byLabel) {
    if (ids.length < 2) continue;
    for (const el of elements)
      if (el.label === label)
        el.problems.push(`duplicate label, also on ${ids.filter((i) => i !== el.id).join(', ')}`);
  }
  return { elements, violations: elements.filter((el) => el.problems.length > 0).length };
}

function renderTable(report) {
  const rows = [['screen', 'status', 'id', 'label', 'problems']];
  for (const screen of report.screens) {
    if (screen.elements.length === 0)
      rows.push([screen.screen, screen.status, '—', '—', screen.error ?? '']);
    for (const el of screen.elements)
      rows.push([
        screen.screen,
        screen.status,
        el.id,
        el.label || '(empty)',
        el.problems.join('; '),
      ]);
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  return rows
    .map((r) =>
      r
        .map((cell, col) => String(cell).padEnd(widths[col]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

// --- Devices & tools --------------------------------------------------------------------------

function which(binary, fallbacks = []) {
  const found = spawnSync('which', [binary], { encoding: 'utf8' });
  if (found.status === 0) return found.stdout.trim();
  return fallbacks.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// Returns { device } or { skip: reason }. Never boots anything (see the header).
function pickDevice(platform, requested) {
  if (platform === 'ios') {
    const xcrun = which('xcrun');
    if (!xcrun) return { skip: 'xcrun not found (install Xcode).' };
    const list = run(xcrun, ['simctl', 'list', '-j', 'devices', 'booted']);
    let booted = [];
    try {
      booted = Object.values(JSON.parse(list.stdout).devices).flat();
    } catch {
      return { skip: 'could not read `xcrun simctl list -j devices booted`.' };
    }
    if (requested) {
      const found = booted.find((d) => d.udid === requested || d.name === requested);
      return found ? { device: found.udid } : { skip: `simulator \`${requested}\` is not booted.` };
    }
    return booted[0]
      ? { device: booted[0].udid }
      : {
          skip: 'no booted simulator. Run `bun run e2e:ios --keep` first (installs the e2e build).',
        };
  }
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || '';
  const adb = which('adb', [path.join(sdk, 'platform-tools', 'adb')]);
  if (!adb) return { skip: 'adb not found (install Android platform-tools or set ANDROID_HOME).' };
  const online = (run(adb, ['devices'], { timeout: 30_000 }).stdout ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial);
  if (requested)
    return online.includes(requested)
      ? { device: requested }
      : { skip: `adb device \`${requested}\` is not online.` };
  if (online.length === 1) return { device: online[0] };
  if (online.length === 0)
    return {
      skip: 'no adb device online. Run `bun run e2e:android --keep` first (installs the e2e build).',
    };
  return { skip: `${online.length} adb devices online; pick one with --device <serial>.` };
}

// Same derivation as scripts/e2e-run.js when node_modules exist; the EAS hook has no
// node_modules and sets MAESTRO_APP_ID on the job instead.
function appId(platform) {
  const expoBin = path.join(projectRoot, 'node_modules', '.bin', 'expo');
  if (fs.existsSync(expoBin)) {
    const config = runJson(NAME, expoBin, ['config', '--type', 'public', '--json'], {
      env: { ...process.env, APP_VARIANT: 'development', CI: '1' },
    });
    const id = platform === 'ios' ? config.ios?.bundleIdentifier : config.android?.package;
    if (id) return { id };
  }
  if (process.env.MAESTRO_APP_ID) return { id: process.env.MAESTRO_APP_ID };
  return {
    skip: 'MAESTRO_APP_ID unknown: run `bun install` (derived from app.config.ts) or set MAESTRO_APP_ID.',
  };
}

// --- Driver -----------------------------------------------------------------------------------

function auditDevice({ platform, device, maestro, id, outDir, interactive }) {
  const screens = [];
  for (const { screen, flow } of SCREENS) {
    const testArgs = [
      '--device',
      device,
      'test',
      flow,
      '-e',
      `MAESTRO_APP_ID=${id}`,
      '--debug-output',
      path.join(outDir, 'debug'),
      '--flatten-debug-output',
    ];
    console.log(`$ maestro ${testArgs.join(' ')}`);
    const nav = run(maestro, testArgs, { stdio: 'inherit', timeout: 300_000 });
    if (nav.status !== 0) {
      const error = `nav flow ${flow} exited ${nav.status ?? 'null'} (see ${display(outDir)}/debug/)`;
      console.error(`${NAME}: ${screen}: ${error}`);
      screens.push({ screen, status: 'nav-failed', error, elements: [] });
      continue;
    }
    const dump = run(maestro, ['--device', device, 'hierarchy'], { timeout: 120_000 });
    let tree;
    try {
      tree = parseHierarchy(dump.stdout ?? '');
    } catch (err) {
      const error = `maestro hierarchy failed: ${err.message} ${(dump.stderr || '').trim()}`.trim();
      console.error(`${NAME}: ${screen}: ${error}`);
      screens.push({ screen, status: 'nav-failed', error, elements: [] });
      continue;
    }
    fs.writeFileSync(path.join(outDir, `${screen}.json`), `${JSON.stringify(tree, null, 2)}\n`);
    const { elements, violations } = auditScreen(tree, interactive.ids);
    screens.push({ screen, status: violations ? 'violations' : 'ok', elements });
  }
  return { platform, device, screens, dynamicIds: interactive.dynamic };
}

function writeReport(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function main(argv) {
  const { values, help } = parseArgs(argv, CLI);
  if (help) return 0;
  const { platform } = values;
  const noFail = values['no-fail'];
  const outDir = path.resolve(values.out ?? `maestro-${platform}/a11y`);
  // Always leave a report.json behind so an artifact upload of `outDir` never fails on a missing path.
  const skip = (reason) => {
    writeReport(outDir, { platform, skipped: reason, screens: [], dynamicIds: [] });
    if (!noFail) return fail(NAME, reason);
    console.log(`${NAME}: skipped (--no-fail): ${reason}`);
    return 0;
  };

  const maestro = which('maestro', [path.join(os.homedir(), '.maestro', 'bin', 'maestro')]);
  if (!maestro)
    return skip(
      '`maestro` not found. Install: curl -Ls "https://get.maestro.mobile.dev" | bash   (CI pins 2.10.0)',
    );
  const picked = pickDevice(platform, values.device);
  if (picked.skip) return skip(picked.skip);
  const app = appId(platform);
  if (app.skip) return skip(app.skip);

  const interactive = collectInteractiveIds();
  console.log(
    `Device: ${picked.device}  MAESTRO_APP_ID=${app.id}  interactive testIDs: ${interactive.ids.size} literal, ${interactive.dynamic.length} dynamic (unaudited)`,
  );
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const report = auditDevice({
    platform,
    device: picked.device,
    maestro,
    id: app.id,
    outDir,
    interactive,
  });
  writeReport(outDir, report);

  console.log(`\n${renderTable(report)}\n`);
  if (report.dynamicIds.length)
    console.log(
      `Unaudited (dynamic testID):\n${report.dynamicIds.map((d) => `  - ${d}`).join('\n')}\n`,
    );
  const bad = report.screens.filter((s) => s.status !== 'ok');
  console.log(
    `${NAME}: ${report.screens.length - bad.length}/${report.screens.length} screens clean; report: ${display(outDir)}/report.json`,
  );
  if (bad.length === 0) return 0;
  const summary = bad.map((s) => `${s.screen} (${s.status})`).join(', ');
  if (noFail) {
    console.log(`${NAME}: findings on ${summary} — exit 0 because of --no-fail.`);
    return 0;
  }
  return fail(NAME, `findings on ${summary}.`);
}

module.exports = {
  INTERACTIVE_ELEMENTS,
  SCREENS,
  // Shared with scripts/flashlight.js (same device / app-id preflight, ADR-0007).
  appId,
  auditScreen,
  collectInteractiveIds,
  extractInteractiveIds,
  flattenNodes,
  labelOf,
  parseHierarchy,
  pickDevice,
  renderTable,
  which,
};

if (require.main === module) runMain(main);
