#!/usr/bin/env node
/**
 * Template end-to-end test (`bun run template:e2e`, the `Template init` CI job; #56, PLAN.md
 * decision 4): spawn a project from this checkout with the documented headless `bun run init`
 * and prove the JS gate passes on its first commit. The template checkout itself is never
 * touched — everything happens in a throwaway copy.
 *
 * In order:
 *   1. copy the working tree (tracked + untracked, not ignored) to a temp dir, one snapshot commit
 *   2. `bun install --frozen-lockfile` there (init needs prettier)
 *   3. `bun run init --yes --skip-doctor --fresh-git ...` with the identity from docs/template-init.md
 *      and no EAS project id (`--eas-project-id=`), no EXPO_TOKEN: nothing may touch the network
 *   4. assert: bun.lock byte-identical, one commit on `main` with a commitlint-valid subject, clean
 *      tree, every self-delete manifest entry gone, `bun install --frozen-lockfile` still a no-op
 *   5. the gate: lint, typecheck, test, knip, i18n:check, format:check, env:check
 *   6. `expo config --type public` resolves the new identity (production variant, updates off)
 *   7. no template identifier left in any tracked file outside `KEEP` (init only warns; this fails)
 *   8. the template checkout's `git status --porcelain` is exactly what it was before
 *
 * Flags: `--dir <path>` (default: a fresh temp dir; removed on success), `--keep` (leave the copy
 * behind, path printed). Exit 1 on the first failed step. Self-deleted by `bun run init`.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { KEEP, REMOVAL, TEMPLATE, initialCommitMessage, scanLeftovers } = require('./init');

const ROOT = path.resolve(__dirname, '..');

/** The identity docs/template-init.md documents for the headless form. */
const IDENTITY = Object.freeze({
  name: 'Acme Mobile',
  slug: 'acme-mobile',
  scheme: 'acme',
  bundleId: 'com.acme.mobile',
  package: 'com.acme.mobile',
  owner: 'acme-team',
  githubRepo: 'acme-inc/acme-mobile',
  easProjectId: '',
});

const INIT_ARGS = [
  'init',
  '--yes',
  '--skip-doctor',
  '--fresh-git',
  '--name',
  IDENTITY.name,
  '--slug',
  IDENTITY.slug,
  '--scheme',
  IDENTITY.scheme,
  '--bundle-id',
  IDENTITY.bundleId,
  '--package',
  IDENTITY.package,
  '--owner',
  IDENTITY.owner,
  '--github-repo',
  IDENTITY.githubRepo,
  // `=` form: `bun run` drops an empty "" argument (docs/template-init.md → No EAS project yet?).
  '--eas-project-id=',
];

/** The gate, in the order that fails fastest (docs/js-gate.md → Running the gate locally). */
const GATE = ['lint', 'typecheck', 'test', 'knip', 'i18n:check', 'format:check', 'env:check'];

class E2EError extends Error {}

function parseArgs(argv) {
  const args = { dir: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') args.keep = true;
    else if (a === '--dir') args.dir = path.resolve(argv[++i] ?? '');
    else if (a.startsWith('--dir=')) args.dir = path.resolve(a.slice('--dir='.length));
    else throw new E2EError(`template-e2e: unknown argument ${a} (flags: --dir <path>, --keep)`);
  }
  if (args.dir === '' || args.dir === ROOT)
    throw new E2EError('template-e2e: --dir needs a path outside this checkout');
  return args;
}

/** Hermetic child env: no EXPO_TOKEN (init must not need EAS), a fixed git identity, no user git config. */
function childEnv() {
  const env = { ...process.env };
  delete env.EXPO_TOKEN;
  return {
    ...env,
    GIT_AUTHOR_NAME: 'template e2e',
    GIT_AUTHOR_EMAIL: 'template-e2e@test.invalid',
    GIT_COMMITTER_NAME: 'template e2e',
    GIT_COMMITTER_EMAIL: 'template-e2e@test.invalid',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/** Runs `cmd` in `cwd`, streaming output; throws on a non-zero exit. */
function run(cwd, cmd, args, { env = childEnv(), quiet = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new E2EError(`${cmd} ${args.join(' ')}: ${r.error.message}`);
  if (r.status !== 0) {
    const tail = quiet ? `\n${(r.stdout || '') + (r.stderr || '')}`.trimEnd() : '';
    throw new E2EError(`${cmd} ${args.join(' ')} exited ${r.status} (in ${cwd})${tail}`);
  }
  return r;
}

/** `git <args>` in `cwd`, captured; returns trimmed stdout. */
function git(cwd, args) {
  return run(cwd, 'git', args, { quiet: true }).stdout.trim();
}

function assert(condition, message) {
  if (!condition) throw new E2EError(`template-e2e: ${message}`);
}

/** Working-tree files of `root`: tracked + untracked (not ignored), deleted ones dropped. */
function workingTreeFiles(root) {
  const out = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return [...new Set(out.split('\0').filter(Boolean))].filter((f) => {
    const abs = path.join(root, f);
    return fs.existsSync(abs) && fs.statSync(abs).isFile();
  });
}

function copyTree(root, dir, files) {
  for (const file of files) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, file), dest);
  }
}

const steps = [];
function step(title, fn) {
  steps.push({ title, fn });
}

step('Copy the working tree to a throwaway dir with one snapshot commit', (ctx) => {
  const files = workingTreeFiles(ROOT);
  copyTree(ROOT, ctx.dir, files);
  git(ctx.dir, ['init', '-q', '-b', 'main']);
  git(ctx.dir, ['add', '-A']);
  git(ctx.dir, ['commit', '-q', '-m', 'chore: template snapshot']);
  console.log(`  ${files.length} files → ${ctx.dir}`);
});

step('bun install --frozen-lockfile (before init: the rewrite step runs prettier)', (ctx) => {
  run(ctx.dir, 'bun', ['install', '--frozen-lockfile']);
});

step('bun run init (headless, --fresh-git, no EAS project id, no EXPO_TOKEN)', (ctx) => {
  run(ctx.dir, 'bun', ['run', ...INIT_ARGS]);
});

step('Lockfile untouched, one commitlint-valid commit on main, clean tree, init gone', (ctx) => {
  assert(
    fs
      .readFileSync(path.join(ROOT, 'bun.lock'))
      .equals(fs.readFileSync(path.join(ctx.dir, 'bun.lock'))),
    'bun.lock changed during init',
  );
  assert(git(ctx.dir, ['rev-list', '--count', 'HEAD']) === '1', 'expected exactly one commit');
  assert(git(ctx.dir, ['branch', '--show-current']) === 'main', 'expected to be on main');
  const subject = git(ctx.dir, ['log', '-1', '--format=%s']);
  assert(
    subject === initialCommitMessage(IDENTITY),
    `unexpected initial commit subject "${subject}"`,
  );
  const status = git(ctx.dir, ['status', '--porcelain']);
  assert(status === '', `working tree not clean after --fresh-git:\n${status}`);
  run(ctx.dir, 'bunx', ['commitlint', '--last', '--verbose']);
  for (const file of REMOVAL.files) {
    assert(!fs.existsSync(path.join(ctx.dir, file)), `${file} should have been self-deleted`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'package.json'), 'utf8'));
  assert(pkg.name === IDENTITY.slug, `package.json name is ${pkg.name}`);
  assert(!pkg.scripts.init && !pkg.scripts['template:e2e'], 'template-only scripts survived');
  console.log(`  "${subject}" — ${REMOVAL.files.length} template files gone, tree clean`);
});

step(
  'bun install --frozen-lockfile (after init: the rewritten package.json still matches bun.lock)',
  (ctx) => {
    run(ctx.dir, 'bun', ['install', '--frozen-lockfile']);
  },
);

for (const script of GATE) {
  step(`bun run ${script}`, (ctx) => {
    run(ctx.dir, 'bun', ['run', script]);
  });
}

step('expo config --type public resolves the new identity (APP_VARIANT=production)', (ctx) => {
  const r = run(ctx.dir, 'bunx', ['expo', 'config', '--type', 'public', '--json'], {
    env: { ...childEnv(), APP_VARIANT: 'production' },
    quiet: true,
  });
  const config = JSON.parse(r.stdout);
  const want = {
    name: IDENTITY.name,
    slug: IDENTITY.slug,
    scheme: IDENTITY.scheme,
    'ios.bundleIdentifier': IDENTITY.bundleId,
    'android.package': IDENTITY.package,
    'extra.eas': undefined,
    'updates.url': undefined,
  };
  const pick = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), config);
  const wrong = Object.entries(want).filter(([key, value]) => pick(key) !== value);
  assert(
    wrong.length === 0,
    `expo config mismatch: ${wrong.map(([k, v]) => `${k} = ${JSON.stringify(pick(k))} (want ${JSON.stringify(v)})`).join(', ')}`,
  );
  console.log(
    `  ${config.name} · ${config.slug} · ${config.ios.bundleIdentifier} · ${config.android.package}`,
  );
});

step('No template identifier left in tracked files (outside KEEP)', (ctx) => {
  const files = {};
  for (const file of git(ctx.dir, ['ls-files', '-z']).split('\0').filter(Boolean)) {
    const abs = path.join(ctx.dir, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) files[file] = fs.readFileSync(abs, 'utf8');
  }
  const hits = scanLeftovers(files, TEMPLATE);
  assert(
    hits.length === 0,
    `template identifiers left behind (add to KEEP in scripts/init.js if intentional):\n${hits
      .map((h) => `  ${h.file}:${h.line}  ${h.token}  ${h.text}`)
      .join('\n')}`,
  );
  console.log(
    `  ${Object.keys(files).length} files scanned; kept on purpose: ${Object.keys(KEEP).join(', ')}`,
  );
});

step('The template checkout is untouched', (ctx) => {
  const now = git(ROOT, ['status', '--porcelain']);
  assert(
    now === ctx.statusBefore,
    `template working tree changed:\n--- before\n${ctx.statusBefore}\n--- after\n${now}`,
  );
});

function main(argv) {
  const args = parseArgs(argv);
  const pkgName = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
  if (pkgName !== TEMPLATE.slug) {
    throw new E2EError(
      `template-e2e: this checkout is "${pkgName}", not the template ("${TEMPLATE.slug}"); nothing to test`,
    );
  }
  const dir = args.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'template-e2e-'));
  if (args.dir) {
    assert(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, `--dir ${dir} is not empty`);
    fs.mkdirSync(dir, { recursive: true });
  }
  const ctx = { dir, statusBefore: git(ROOT, ['status', '--porcelain']) };
  const timings = [];
  const started = Date.now();
  console.log(`template-e2e: ${TEMPLATE.slug} → ${IDENTITY.slug} in ${dir}\n`);
  try {
    for (const [i, s] of steps.entries()) {
      const t = Date.now();
      console.log(`▶ ${i + 1}/${steps.length} ${s.title}`);
      s.fn(ctx);
      timings.push([s.title, Date.now() - t]);
      console.log(`  ok (${((Date.now() - t) / 1000).toFixed(1)}s)\n`);
    }
  } catch (error) {
    if (!(error instanceof E2EError)) throw error;
    console.error(`\n✖ ${error.message}\n  copy kept for inspection: ${dir}`);
    return 1;
  }
  console.log('Summary');
  for (const [title, ms] of timings)
    console.log(`  ${(ms / 1000).toFixed(1).padStart(6)}s  ${title}`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  total`);
  if (args.keep) console.log(`\nCopy kept: ${dir}`);
  else fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n✔ ${IDENTITY.slug}: the JS gate passes on the first commit.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof E2EError ? error.message : error);
    process.exitCode = 1;
  }
}
