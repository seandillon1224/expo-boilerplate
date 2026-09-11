#!/usr/bin/env node
/**
 * `bun run doctor` — toolchain check with fix hints (T7.2, #53).
 *
 * One row per tool: status, the version found, the version expected and (when not ok) the exact
 * install command for macOS (Homebrew) and, where it differs, Linux. Also the first `bun run init`
 * step (`--skip-doctor` skips it there).
 *
 * Usage:
 *   bun run doctor            # table + summary; exit 1 only when a REQUIRED tool is missing
 *   bun run doctor --strict   # warnings fail too (CI, #56)
 *   bun run doctor --json     # { rows, summary } for machines
 *
 * Statuses:
 *   ok       found and compatible
 *   warn     missing / incompatible / logged out, but only an optional lane is affected
 *   missing  a REQUIRED tool (Bun, Node, git) is absent or incompatible → exit 1
 *   skip     not applicable on this platform (Xcode off macOS); never fails, even with --strict
 *
 * Design: every check is a pure function of `ctx` (`run`, `env`, `platform`, `exists`, `read`,
 * `home`, `root`), so `scripts/__tests__/doctor.test.ts` injects a fake `run` and never touches a
 * real binary. Plain Node/JS (no @types/node in tsconfig `types`); runs under Bun.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/* ------------------------------------------------------------------------------------------ */
/* Expected versions — one place, with the reason for each number                              */
/* ------------------------------------------------------------------------------------------ */

const EXPECTED = Object.freeze({
  /** `bun.lock` is a text lockfile (`saveTextLockfile` in bunfig.toml); Bun < 1.2 cannot read it. */
  bunMin: '1.2.0',
  /** Fallback when `.node-version` is unreadable; the file is the source of truth. */
  nodeMajor: 22,
  /** `git switch` / `init.defaultBranch` era; anything a laptop has. */
  gitMin: '2.28.0',
  /**
   * `.eas/workflows/e2e.yml` and `.github/workflows/ci.yml` pin `maestro_version: 2.10.0`;
   * 2.9.0 is the first release without the 1px-viewport bug on Chrome 150+ (ci.yml, `maestro-web`).
   */
  maestroMin: '2.9.0',
  maestroPinned: '2.10.0',
  /** Expo SDK 57 / React Native 0.86 need Xcode 16+; EAS's default macOS image runs Xcode 26. */
  xcodeMin: '16.0',
  /**
   * Maestro CLI needs JDK 17+ (ci.yml, `maestro-web`), and the Android build-tools that
   * `@expo/repack-app` shells out to (`aapt2` / `apksigner`) run on the same JDK. EAS builds
   * Android on JDK 17; a newer LTS (21) is fine.
   */
  javaMajorMin: 17,
});

const FOREIGN_LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

/* ------------------------------------------------------------------------------------------ */
/* Version helpers                                                                             */
/* ------------------------------------------------------------------------------------------ */

/** First `x.y.z`-ish token in `text` (e.g. "eas-cli/23.2.0 darwin" → "23.2.0"); null if none. */
function parseVersion(text) {
  const m = String(text ?? '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? m[0] : null;
}

/** Numeric [major, minor, patch] of a version string; missing parts are 0. */
function versionParts(version) {
  return String(version)
    .split('.')
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0)
    .concat([0, 0, 0])
    .slice(0, 3);
}

/** -1 / 0 / 1 like a comparator; compares numeric parts, ignores pre-release suffixes. */
function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

const atLeast = (found, min) => compareVersions(found, min) >= 0;
const major = (version) => versionParts(version)[0];

/* ------------------------------------------------------------------------------------------ */
/* Command runner                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * `run(cmd, args)` → `{ status, stdout, stderr }`; `status` is null when the binary does not
 * exist (ENOENT) or timed out. Tests inject a fake with the same shape.
 */
function realRun(cmd, args = [], { cwd, timeout = 30_000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, env: process.env });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

const output = (r) => `${r.stdout}\n${r.stderr}`.trim();
const ran = (r) => r.status !== null;

/** Runs `cmd` from PATH, then each fallback path, returning the first that exists. */
function runWithFallbacks(ctx, cmd, args, fallbacks = []) {
  const first = ctx.run(cmd, args);
  if (ran(first)) return { ...first, bin: cmd };
  for (const fallback of fallbacks) {
    if (!ctx.exists(fallback)) continue;
    const r = ctx.run(fallback, args);
    if (ran(r)) return { ...r, bin: fallback };
  }
  return { ...first, bin: null };
}

const HINT = Object.freeze({
  bun: 'curl -fsSL https://bun.sh/install | bash  (or: brew install oven-sh/bun/bun; then `bun upgrade`)',
  node: 'fnm install / nvm install (reads .node-version)  (or: brew install node@22 | apt install nodejs)',
  git: 'brew install git  (Linux: apt install git)',
  lefthook: 'bunx lefthook install  (runs on `bun install` via the prepare script)',
  eas: 'bun install  (eas-cli is a devDependency; run it with `bun run eas`)',
  easLogin: 'bun run eas login  (CI: set EXPO_TOKEN)',
  gh: 'brew install gh  (Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md)',
  ghAuth: 'gh auth login  (needed by bun run repo:settings:*)',
  maestro: 'curl -Ls "https://get.maestro.mobile.dev" | bash  (then add ~/.maestro/bin to PATH)',
  xcode:
    'Install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app && sudo xcodebuild -license accept',
  simulators: 'Xcode → Settings → Components → install an iOS Simulator runtime',
  android:
    'brew install --cask android-commandlinetools && export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools" && sdkmanager "platform-tools" "emulator" "build-tools;36.0.0"  (Linux: https://developer.android.com/studio#command-line-tools-only)',
  java: 'brew install --cask temurin@21  (Linux: apt install openjdk-21-jdk)',
});

/* ------------------------------------------------------------------------------------------ */
/* Checks                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** A row: `{ status, found, expected, hint? }`; `status` ∈ ok | warn | missing | skip. */
const row = (status, found, expected, hint) => ({ status, found, expected, hint });

/**
 * Ordered checks. `required` decides whether a failure is `missing` (exit 1) or `warn`;
 * `platforms` restricts a check (others get `skip`); `lane` names what the tool is for.
 */
const CHECKS = [
  {
    id: 'bun',
    title: 'Bun',
    required: true,
    lane: 'everything (package manager, scripts)',
    check(ctx) {
      const r = ctx.run('bun', ['--version']);
      const expected = `>= ${EXPECTED.bunMin}`;
      const found = ran(r) ? parseVersion(r.stdout) : null;
      if (!found) return row('missing', 'not found', expected, HINT.bun);
      if (!atLeast(found, EXPECTED.bunMin)) return row('missing', found, expected, HINT.bun);
      return row('ok', found, expected);
    },
  },
  {
    id: 'lockfiles',
    title: 'Lockfiles',
    required: false,
    lane: 'bun-only installs',
    check(ctx) {
      const foreign = FOREIGN_LOCKFILES.filter((f) => ctx.exists(path.join(ctx.root, f)));
      const expected = 'bun.lock only';
      if (foreign.length) {
        return row(
          'warn',
          `${foreign.join(', ')} present`,
          expected,
          `rm ${foreign.join(' ')} && bun install  (npm/yarn/pnpm resolve a different tree)`,
        );
      }
      return row('ok', 'bun.lock only', expected);
    },
  },
  {
    id: 'node',
    title: 'Node',
    required: true,
    lane: 'scripts, lefthook, eas-cli',
    check(ctx) {
      const wanted = major(parseVersion(ctx.read('.node-version')) ?? String(EXPECTED.nodeMajor));
      const expected = `${wanted}.x (.node-version)`;
      const r = ctx.run('node', ['--version']);
      const found = ran(r) ? parseVersion(r.stdout) : null;
      if (!found) return row('missing', 'not found', expected, HINT.node);
      if (major(found) !== wanted) return row('missing', found, expected, HINT.node);
      return row('ok', found, expected);
    },
  },
  {
    id: 'git',
    title: 'git',
    required: true,
    lane: 'everything',
    check(ctx) {
      const r = ctx.run('git', ['--version']);
      const expected = `>= ${EXPECTED.gitMin}`;
      const found = ran(r) ? parseVersion(r.stdout) : null;
      if (!found) return row('missing', 'not found', expected, HINT.git);
      if (!atLeast(found, EXPECTED.gitMin)) return row('missing', found, expected, HINT.git);
      return row('ok', found, expected);
    },
  },
  {
    id: 'lefthook',
    title: 'lefthook hooks',
    required: false,
    lane: 'pre-commit / commit-msg / pre-push hooks',
    check(ctx) {
      const expected = '.git/hooks/pre-commit installed by lefthook';
      if (!ctx.exists(path.join(ctx.root, '.git'))) {
        return row('warn', 'not a git checkout', expected, 'git init && bunx lefthook install');
      }
      const hook = ctx.read('.git/hooks/pre-commit');
      if (hook === null) return row('warn', 'no pre-commit hook', expected, HINT.lefthook);
      if (!/lefthook/i.test(hook))
        return row('warn', 'pre-commit hook is not lefthook', expected, HINT.lefthook);
      return row('ok', 'installed', expected);
    },
  },
  {
    id: 'eas',
    title: 'EAS CLI',
    required: false,
    lane: 'EAS build / update / workflows, env:pull, devices:*',
    check(ctx) {
      const pinned = ctx.easCliRange ?? '';
      const wanted = major(parseVersion(pinned) ?? '0');
      const expected = wanted ? `${wanted}.x (package.json eas-cli ${pinned})` : 'repo-pinned';
      const r = ctx.run('bun', ['run', 'eas', '--version']);
      const found = ran(r) ? parseVersion(output(r).match(/eas-cli\/(\S+)/)?.[1]) : null;
      if (!found) return row('warn', 'not resolvable', expected, HINT.eas);
      if (wanted && major(found) !== wanted) return row('warn', found, expected, HINT.eas);
      return row('ok', found, expected);
    },
  },
  {
    id: 'eas-login',
    title: 'EAS login',
    required: false,
    lane: 'e2e:build, env:pull, devices:*',
    check(ctx, rows) {
      const expected = 'logged in (or EXPO_TOKEN)';
      if (rows.eas?.status !== 'ok') return row('skip', 'EAS CLI unavailable', expected);
      if (ctx.env.EXPO_TOKEN) return row('ok', 'EXPO_TOKEN set', expected);
      const r = ctx.run('bun', ['run', 'eas', 'whoami', '--non-interactive']);
      if (!ran(r) || r.status !== 0) return row('warn', 'logged out', expected, HINT.easLogin);
      const account = r.stdout.trim().split('\n').pop() || 'logged in';
      return row('ok', account, expected);
    },
  },
  {
    id: 'gh',
    title: 'GitHub CLI',
    required: false,
    lane: 'repo:settings:*, PR automation',
    check(ctx) {
      const r = ctx.run('gh', ['--version']);
      const expected = 'any';
      const found = ran(r) ? parseVersion(r.stdout) : null;
      if (!found) return row('warn', 'not found', expected, HINT.gh);
      return row('ok', found, expected);
    },
  },
  {
    id: 'gh-auth',
    title: 'GitHub auth',
    required: false,
    lane: 'repo:settings:*',
    check(ctx, rows) {
      const expected = 'gh auth status = logged in';
      if (rows.gh?.status !== 'ok') return row('skip', 'gh unavailable', expected);
      const r = ctx.run('gh', ['auth', 'status']);
      if (!ran(r) || r.status !== 0) return row('warn', 'logged out', expected, HINT.ghAuth);
      const account = output(r).match(/account (\S+)/)?.[1];
      return row('ok', account ? `logged in as ${account}` : 'logged in', expected);
    },
  },
  {
    id: 'maestro',
    title: 'Maestro',
    required: false,
    lane: 'e2e:web, e2e:ios, e2e:android',
    check(ctx) {
      const expected = `>= ${EXPECTED.maestroMin} (CI pins ${EXPECTED.maestroPinned})`;
      const r = runWithFallbacks(
        ctx,
        'maestro',
        ['--version'],
        [path.join(ctx.home, '.maestro', 'bin', 'maestro')],
      );
      // The CLI may print JVM warnings first; the version is the last x.y.z line.
      const line = output(r)
        .split('\n')
        .reverse()
        .find((l) => /^\d+\.\d+\.\d+/.test(l.trim()));
      const found = ran(r) ? parseVersion(line) : null;
      if (!found) return row('warn', 'not found', expected, HINT.maestro);
      if (!atLeast(found, EXPECTED.maestroMin)) {
        return row('warn', found, expected, `${HINT.maestro} — older releases have selector bugs`);
      }
      const where = r.bin === 'maestro' ? '' : ` (${r.bin}, not on PATH)`;
      return row('ok', `${found}${where}`, expected);
    },
  },
  {
    id: 'xcode',
    title: 'Xcode',
    required: false,
    platforms: ['darwin'],
    lane: 'iOS lane (e2e:repack / e2e:ios, expo run:ios)',
    check(ctx) {
      const expected = `>= ${EXPECTED.xcodeMin} + an iOS simulator`;
      const r = ctx.run('xcodebuild', ['-version']);
      const found =
        ran(r) && r.status === 0 ? parseVersion(r.stdout.match(/Xcode (\S+)/)?.[1]) : null;
      if (!found) return row('warn', 'not found', expected, HINT.xcode);
      if (!atLeast(found, EXPECTED.xcodeMin)) return row('warn', found, expected, HINT.xcode);
      const sims = ctx.run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
      let count = 0;
      if (ran(sims) && sims.status === 0) {
        try {
          const devices = JSON.parse(sims.stdout).devices ?? {};
          count = Object.values(devices).flat().length;
        } catch {
          count = 0;
        }
      }
      if (!count) return row('warn', `${found}, no simulators`, expected, HINT.simulators);
      return row('ok', `${found}, ${count} simulators`, expected);
    },
  },
  {
    id: 'android',
    title: 'Android SDK',
    required: false,
    lane: 'Android lane (e2e:repack / e2e:android, expo run:android)',
    check(ctx) {
      const expected = 'ANDROID_HOME (or ANDROID_SDK_ROOT) + adb + emulator';
      const sdk = ctx.env.ANDROID_HOME || ctx.env.ANDROID_SDK_ROOT || '';
      const problems = [];
      if (!sdk) problems.push('ANDROID_HOME unset');
      else if (!ctx.exists(sdk)) problems.push(`ANDROID_HOME=${sdk} missing`);
      const adb = runWithFallbacks(
        ctx,
        'adb',
        ['version'],
        sdk ? [path.join(sdk, 'platform-tools', 'adb')] : [],
      );
      const adbVersion = ran(adb)
        ? parseVersion(adb.stdout.match(/Bridge version (\S+)/)?.[1])
        : null;
      if (!adbVersion) problems.push('adb missing');
      const emulator = runWithFallbacks(
        ctx,
        'emulator',
        ['-version'],
        sdk ? [path.join(sdk, 'emulator', 'emulator')] : [],
      );
      const emulatorVersion = ran(emulator)
        ? parseVersion(output(emulator).match(/emulator version (\S+)/)?.[1])
        : null;
      if (!emulatorVersion) problems.push('emulator missing');
      if (problems.length) return row('warn', problems.join(', '), expected, HINT.android);
      return row('ok', `adb ${adbVersion}, emulator ${emulatorVersion}`, expected);
    },
  },
  {
    id: 'java',
    title: 'Java',
    required: false,
    lane: 'Maestro CLI, Android repack (apktool / apksigner)',
    check(ctx) {
      const expected = `JDK >= ${EXPECTED.javaMajorMin}`;
      const r = ctx.run('java', ['-version']);
      // `java -version` prints to stderr: `openjdk version "21.0.10" 2026-01-20 LTS`.
      const raw = ran(r) ? output(r).match(/version "([^"]+)"/)?.[1] : null;
      // Legacy "1.8.0_x" means Java 8.
      const found = raw ? (raw.startsWith('1.') ? raw.split('.')[1] : parseVersion(raw)) : null;
      if (!found) return row('warn', 'not found', expected, HINT.java);
      if (major(found) < EXPECTED.javaMajorMin) return row('warn', raw, expected, HINT.java);
      return row('ok', raw, expected);
    },
  },
];

/** Real context for the current machine; tests build their own. */
function realContext(root = process.cwd()) {
  const read = (file) => {
    const abs = path.join(root, file);
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  };
  const pkg = JSON.parse(read('package.json') ?? '{}');
  return {
    root,
    home: os.homedir(),
    platform: process.platform,
    env: process.env,
    exists: (p) => fs.existsSync(p),
    read,
    run: (cmd, args) => realRun(cmd, args, { cwd: root }),
    easCliRange: pkg.devDependencies?.['eas-cli'] ?? pkg.dependencies?.['eas-cli'],
  };
}

/** Runs every check against `ctx`; returns rows in order, each with `id`, `title`, `required`, `lane`. */
function runChecks(ctx, checks = CHECKS) {
  const byId = {};
  const rows = [];
  for (const c of checks) {
    let result;
    if (c.platforms && !c.platforms.includes(ctx.platform)) {
      result = row(
        'skip',
        `${c.platforms.join('/')} only`,
        '—',
        `${c.lane.split(' (')[0]} unavailable on ${ctx.platform}`,
      );
    } else {
      try {
        result = c.check(ctx, byId);
      } catch (error) {
        result = row(c.required ? 'missing' : 'warn', `check failed: ${error.message}`, '—');
      }
    }
    const full = {
      id: c.id,
      title: c.title,
      required: Boolean(c.required),
      lane: c.lane,
      ...result,
    };
    byId[c.id] = full;
    rows.push(full);
  }
  return rows;
}

/* ------------------------------------------------------------------------------------------ */
/* Output                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const MARK = { ok: 'ok', warn: 'warn', missing: 'MISSING', skip: 'skip' };

/** Fixed-width table: status, check, found, expected — then the fix hints for non-ok rows. */
function renderTable(rows) {
  const cols = [
    ['status', (r) => MARK[r.status]],
    ['check', (r) => r.title + (r.required ? ' *' : '')],
    ['found', (r) => r.found],
    ['expected', (r) => r.expected],
  ];
  const cells = rows.map((r) => cols.map(([, get]) => String(get(r) ?? '')));
  const widths = cols.map(([name], i) => Math.max(name.length, ...cells.map((c) => c[i].length)));
  const line = (parts) =>
    parts
      .map((p, i) => p.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  const out = [
    line(cols.map(([name]) => name.toUpperCase())),
    line(widths.map((w) => '-'.repeat(w))),
  ];
  for (const c of cells) out.push(line(c));
  const hints = rows.filter((r) => r.status !== 'ok' && r.hint);
  if (hints.length) {
    out.push('', 'Fix:');
    for (const r of hints) out.push(`  ${r.title}: ${r.hint}`);
  }
  out.push('', '* required — everything else only affects the lane it is listed for.');
  return out.join('\n');
}

/** Counts per status plus the exit code (`1` when a required tool is missing, or any warn with `strict`). */
function summarize(rows, { strict = false } = {}) {
  const count = (s) => rows.filter((r) => r.status === s).length;
  const missing = rows.filter((r) => r.status === 'missing');
  const warnings = rows.filter((r) => r.status === 'warn');
  const summary = {
    ok: count('ok'),
    warn: warnings.length,
    missing: missing.length,
    skip: count('skip'),
    strict,
    exitCode: missing.length || (strict && warnings.length) ? 1 : 0,
  };
  let message = `doctor: ${summary.ok} ok, ${summary.warn} warn, ${summary.missing} missing, ${summary.skip} skipped.`;
  if (missing.length) {
    message += ` Required: ${missing.map((r) => r.title).join(', ')} — fix before continuing.`;
  } else if (warnings.length) {
    message += strict
      ? ` --strict: warnings fail (${warnings.map((r) => r.title).join(', ')}).`
      : ` Warnings only affect optional lanes (${warnings.map((r) => r.lane.split(' (')[0]).join('; ')}).`;
  } else {
    message += ' Toolchain complete.';
  }
  return { ...summary, message };
}

function parseArgs(argv) {
  const out = { json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--strict') out.strict = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`doctor: unknown argument ${arg}`);
  }
  return out;
}

function usage() {
  return 'Usage: bun run doctor [--strict] [--json]\n\n  --strict   warnings exit 1 as well (CI)\n  --json     machine-readable { rows, summary }\n\nSee docs/template-init.md → Toolchain check.';
}

/**
 * The `bun run init` step: prints the table, throws when a required tool is missing so init stops
 * before writing anything. `--skip-doctor` on init skips it (`when`).
 */
const doctorStep = {
  id: 'doctor',
  title: 'Toolchain check',
  when: ({ args }) => !args['skip-doctor'],
  run({ root, log }) {
    const rows = runChecks(realContext(root));
    const summary = summarize(rows);
    log(renderTable(rows));
    log(`\n${summary.message}`);
    if (summary.exitCode) {
      throw new Error(
        'init: toolchain check failed — fix the MISSING rows above, or pass --skip-doctor.',
      );
    }
    return { rows, summary };
  },
};

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const rows = runChecks(realContext());
  const summary = summarize(rows, { strict: args.strict });
  if (args.json) {
    console.log(JSON.stringify({ rows, summary }, null, 2));
  } else {
    console.log(renderTable(rows));
    console.log(`\n${summary.message}`);
  }
  return summary.exitCode;
}

module.exports = {
  CHECKS,
  EXPECTED,
  compareVersions,
  doctorStep,
  parseArgs,
  parseVersion,
  renderTable,
  runChecks,
  summarize,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
