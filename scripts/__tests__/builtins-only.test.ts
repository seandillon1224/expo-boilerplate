/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node scripts under test; no @types/node */
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

/**
 * The EAS `maestro` jobs run these scripts with `node scripts/<x>.js` from a checkout that never
 * had `bun install` run in it (.eas/workflows/e2e.yml: `after_maestro_tests` hooks). A single
 * `require('chalk')` — or a transitive one, through a helper — turns a red flow into a crashed
 * hook, and the failure shows up as a missing artifact rather than an error anyone reads.
 *
 * So: every module these entry points reach must require only `node:`-prefixed built-ins and
 * other files inside `scripts/`. The `node:` prefix is part of the rule — a bare `require('fs')`
 * can be shadowed by a package of that name, and the prefix is what makes "built-in" greppable.
 */
const SCRIPTS = path.resolve(__dirname, '..');

/** Entry points run by an EAS hook (or reachable from one). */
const ENTRY_POINTS = [
  'e2e-device-logs.js',
  'a11y-audit.js',
  'flashlight.js',
  'e2e-common.js',
  ...fs
    .readdirSync(path.join(SCRIPTS, 'lib'))
    .filter((f: string) => f.endsWith('.js'))
    .map((f: string) => path.join('lib', f)),
];

const BUILTINS: Set<string> = new Set(builtinModules);

/** Every `require('…')` specifier in a source file, comments and strings included (deliberately blunt). */
function requiresIn(source: string): string[] {
  return [...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
}

const isRelative = (specifier: string) => specifier.startsWith('./') || specifier.startsWith('../');

/** null when the specifier is allowed, else why it is not. */
function offence(specifier: string): string | null {
  if (specifier.startsWith('node:')) {
    return BUILTINS.has(specifier) || BUILTINS.has(specifier.slice(5))
      ? null
      : `\`${specifier}\` is not a Node built-in`;
  }
  if (isRelative(specifier)) return null;
  if (BUILTINS.has(specifier))
    return `\`${specifier}\` must be written as \`node:${specifier}\` (the prefix is the rule)`;
  return `\`${specifier}\` is a package — an EAS hook runs without node_modules`;
}

/** Walks the require graph from `entry`, returning `"<file>: <reason>"` for each violation. */
function walk(entry: string, seen = new Set<string>(), found: string[] = []): string[] {
  const file = path.resolve(SCRIPTS, entry);
  if (seen.has(file)) return found;
  seen.add(file);
  const rel = path.relative(SCRIPTS, file);
  if (!fs.existsSync(file)) {
    found.push(`${rel}: required file does not exist`);
    return found;
  }
  for (const specifier of requiresIn(fs.readFileSync(file, 'utf8'))) {
    const problem = offence(specifier);
    if (problem) found.push(`${rel}: ${problem}`);
    else if (isRelative(specifier)) {
      const target = path.resolve(path.dirname(file), specifier);
      const resolved =
        fs.existsSync(target) && fs.statSync(target).isFile() ? target : `${target}.js`;
      if (!resolved.startsWith(`${SCRIPTS}${path.sep}`)) {
        found.push(`${rel}: \`${specifier}\` leaves scripts/`);
        continue;
      }
      walk(resolved, seen, found);
    }
  }
  return found;
}

describe('EAS-hook scripts use Node built-ins only', () => {
  it.each(ENTRY_POINTS)('%s and everything it requires', (entry) => {
    expect(walk(entry)).toEqual([]);
  });

  it('reaches the shared libs through the entry points', () => {
    const seen = new Set<string>();
    for (const entry of ENTRY_POINTS) walk(entry, seen);
    const files = [...seen].map((f) => path.relative(SCRIPTS, f));
    expect(files).toEqual(expect.arrayContaining(['lib/args.js', 'lib/device.js', 'lib/bin.js']));
  });

  // The guard is only worth having if it bites: these are the three ways it has to fail.
  it('flags a package, a bare built-in and a broken relative path', () => {
    expect(offence('chalk')).toContain('an EAS hook runs without node_modules');
    expect(offence('@expo/fingerprint')).toContain('an EAS hook runs without node_modules');
    expect(offence('fs')).toContain('node:fs');
    expect(offence('node:fs')).toBeNull();
    expect(offence('./lib/device')).toBeNull();

    expect(requiresIn("const c = require('chalk');\nconst fs = require('node:fs');")).toEqual([
      'chalk',
      'node:fs',
    ]);
    expect(walk('__tests__/fixtures/not-a-real-script.js')).toEqual([
      '__tests__/fixtures/not-a-real-script.js: required file does not exist',
    ]);
  });
});
