#!/usr/bin/env node
/**
 * `bun run init` — rebrand a fresh copy of the template (T7.1, #52).
 *
 * Rewrites every site where the template's own identity is hardcoded (app.config.ts, package.json,
 * README badges, Maestro / EAS workflow envs, expo.dev URLs, docs) with the new app's name, slug,
 * scheme, iOS bundle id, Android package, EAS project id, Expo account and GitHub repo.
 *
 * Usage:
 *   bun run init                       # interactive; defaults derived from the folder name
 *   bun run init --yes --name "Acme" --slug acme --owner acme-team --bundle-id com.acme.app \
 *     --package com.acme.app --scheme acme --eas-project-id <uuid> --github-repo acme/acme-app
 *   bun run init --dry-run ...         # print the diff and the summary table, write nothing
 *   bun run init --yes --eas-project-id= ...   # no EAS project yet (`=` form: bun drops an empty "")
 *   bun run init --skip-doctor ...     # skip the toolchain check (`bun run doctor`) that runs first
 *
 * Design:
 *   - `MANIFEST` lists every (file, pattern) init touches. A pattern that matches fewer times than
 *     expected fails the run before anything is written, so a later ticket that moves an identifier
 *     breaks `scripts/__tests__/init.test.ts` (the drift guard) instead of silently leaving it behind.
 *   - After rewriting, tracked files are scanned for leftover template identifiers; hits are
 *     reported as warnings (never failures) and `KEEP` lists the ones that are intentional.
 *   - `steps` is the ordered list of what init does: the toolchain check (#53, `scripts/doctor.js`)
 *     first, then rewrite + scan. #54 appends "reset queue ledger", "clear changelog", "fresh git
 *     history" and "self-delete" steps. A step's optional `when({ args })` can opt it out.
 *
 * Plain Node/JS (no @types/node in tsconfig `types`), same as the other scripts; runs under Bun.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawnSync } = require('node:child_process');
const { doctorStep } = require('./doctor');

/** The template's own identity: the values every pattern below matches on. */
const TEMPLATE = Object.freeze({
  name: 'Expo Boilerplate',
  slug: 'expo-boilerplate',
  scheme: 'expoboilerplate',
  bundleId: 'com.seandillon.expoboilerplate',
  package: 'com.seandillon.expoboilerplate',
  easProjectId: '885fa7d0-e079-4722-bafa-e05da702b132',
  owner: 'seandillon1224',
  githubRepo: 'seandillon1224/expo-boilerplate',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prompt order, flag names and validation for each identity field. `defaultFrom` derives the
 * interactive default from the values already collected (and the folder name).
 */
const FIELDS = [
  {
    key: 'name',
    flag: 'name',
    label: 'App name (display name; variants get " (Dev)" etc. appended)',
    defaultFrom: (d) => d.name,
    validate: (v) => (v.trim() && !/['"\n]/.test(v) ? null : 'must be non-empty, no quotes'),
  },
  {
    key: 'slug',
    flag: 'slug',
    label: 'Slug (Expo project slug, package.json name, EAS Hosting dev-domain)',
    defaultFrom: (d) => d.slug,
    validate: (v) =>
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? null : 'lowercase letters, digits and single dashes',
  },
  {
    key: 'owner',
    flag: 'owner',
    label: 'Expo account (expo.dev/accounts/<owner>; the EAS project lives under it)',
    defaultFrom: (d) => d.owner,
    validate: (v) => (/^[a-z0-9][a-z0-9-]*$/i.test(v) ? null : 'letters, digits and dashes'),
  },
  {
    key: 'bundleId',
    flag: 'bundle-id',
    label: 'iOS bundle identifier (production; variants append .dev / .staging / .uat)',
    defaultFrom: (d, a) =>
      `com.${(a.owner || d.owner).toLowerCase().replace(/[^a-z0-9]/g, '')}.${a.scheme || d.scheme}`,
    validate: (v) =>
      /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v) ? null : 'reverse-DNS, e.g. com.acme.app',
  },
  {
    key: 'package',
    flag: 'package',
    label: 'Android package (application id; no dashes, segments start with a letter)',
    defaultFrom: (d, a) => (a.bundleId || '').replace(/-/g, '') || d.package,
    validate: (v) =>
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(v) ? null : 'reverse-DNS, e.g. com.acme.app',
  },
  {
    key: 'scheme',
    flag: 'scheme',
    label: 'URL scheme (deep links; variants append -dev / -staging / -uat)',
    defaultFrom: (d) => d.scheme,
    validate: (v) => (/^[a-z][a-z0-9+.-]*$/.test(v) ? null : 'lowercase, starts with a letter'),
  },
  {
    key: 'easProjectId',
    flag: 'eas-project-id',
    label: 'EAS project id (UUID from `eas init` / expo.dev; leave empty to link later)',
    defaultFrom: () => '',
    validate: (v) => (v === '' || UUID_RE.test(v) ? null : 'a UUID, or empty'),
  },
  {
    key: 'githubRepo',
    flag: 'github-repo',
    label: 'GitHub repo (owner/name; README badges, deployment reviewers)',
    defaultFrom: (d, a) => `${a.owner || d.owner}/${a.slug || d.slug}`,
    validate: (v) => (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(v) ? null : 'owner/name'),
  },
];

const FLAGS = new Set([...FIELDS.map((f) => f.flag), 'yes', 'dry-run', 'skip-doctor', 'help']);

/** Derive sensible defaults from the working-directory name and the OS user. */
function deriveDefaults(folderName, username = os.userInfo().username) {
  const slug =
    folderName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'my-app';
  const name = slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  const scheme = slug.replace(/-/g, '');
  const owner = username.toLowerCase().replace(/[^a-z0-9-]/g, '') || 'owner';
  return {
    name,
    slug,
    scheme,
    owner,
    bundleId: `com.${owner}.${scheme}`,
    package: `com.${owner}.${scheme}`,
  };
}

/** Returns `{ field: message }` for every invalid value; empty when the identity is valid. */
function validateIdentity(identity) {
  const errors = {};
  for (const field of FIELDS) {
    const value = identity[field.key];
    const message = typeof value === 'string' ? field.validate(value) : 'missing';
    if (message) errors[field.key] = message;
  }
  return errors;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`init: unknown argument ${arg}`);
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!FLAGS.has(flag)) throw new Error(`init: unknown argument --${flag}`);
    if (flag === 'yes' || flag === 'dry-run' || flag === 'skip-doctor' || flag === 'help') {
      out[flag] = true;
      continue;
    }
    const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
    if (value === undefined) throw new Error(`init: --${flag} needs a value`);
    out[flag] = value;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Rewrite manifest                                                                            */
/* ------------------------------------------------------------------------------------------ */

const EXPO_PROJECT_URL = (t) => `expo.dev/accounts/${t.owner}/projects/${t.slug}`;

/**
 * A rule: `find` (string = every occurrence; RegExp = every match when /g) → `replace` (a string
 * for string rules, a `(match) => string` replacer for regex rules); `min` expected matches.
 */
const rule = (id, find, replace, min = 1) => ({ id, find, replace, min });
/** Replacer for a regex with two groups around the value: keeps the groups, swaps the middle. */
const between = (value) => (m) => `${m[1]}${value}${m[2]}`;
/** Replacer for a regex with one leading group: keeps it, appends the value. */
const after = (value) => (m) => `${m[1]}${value}`;

/**
 * Every file init rewrites and the patterns it expects to find there. Regex rules match the
 * structure around a value (so they stay precise); string rules match a template identifier that
 * has no other meaning in that file. Order matters within a file: rules run on the output of the
 * previous one, which is how the same template token maps to different values (bundleId vs
 * package) depending on context.
 */
function buildManifest(id) {
  const easId = id.easProjectId;
  const workflowUrls = [
    rule('expo.dev project URL', `${EXPO_PROJECT_URL(TEMPLATE)}`, EXPO_PROJECT_URL(id)),
  ];
  const maestroAppId = [
    rule(
      'MAESTRO_APP_ID (iOS job)',
      /(MAESTRO_APP_ID: )\S+(\n\s+params:\n\s+build_id: \$\{\{ needs\.repack_ios)/g,
      between(`${id.bundleId}.dev`),
    ),
    rule(
      'MAESTRO_APP_ID (Android job)',
      /(MAESTRO_APP_ID: )\S+(\n\s+params:\n\s+build_id: \$\{\{ needs\.repack_android)/g,
      between(`${id.package}.dev`),
    ),
  ];
  return [
    {
      file: 'app.config.ts',
      rules: [
        rule('BASE.name', /^(  name: ')[^']*(',)$/gm, between(id.name)),
        rule('BASE.slug', /^(  slug: ')[^']*(',)$/gm, between(id.slug)),
        rule('BASE.scheme', /^(  scheme: ')[^']*(',)$/gm, between(id.scheme)),
        rule('BASE.bundleId', /^(  bundleId: ')[^']*(',)$/gm, between(id.bundleId)),
        rule('BASE.androidPackage', /^(  androidPackage: ')[^']*(',)$/gm, between(id.package)),
        rule('EAS_PROJECT_ID', /^(const EAS_PROJECT_ID: string = ')[^']*(';)$/gm, between(easId)),
        rule(
          'EAS project comment',
          `@${TEMPLATE.owner}/${TEMPLATE.slug}`,
          `@${id.owner}/${id.slug}`,
        ),
      ],
    },
    {
      file: 'package.json',
      rules: [rule('name', /^(  "name": ")[^"]*(",)$/gm, between(id.slug))],
    },
    {
      file: 'README.md',
      rules: [
        rule('title', /^# [^\n]*$/m, () => `# ${id.name}`),
        rule('badge repo', TEMPLATE.githubRepo, id.githubRepo),
      ],
    },
    {
      file: 'CLAUDE.md',
      rules: [
        rule('title', /^# [^\n]* — working agreement$/m, () => `# ${id.name} — working agreement`),
      ],
    },
    {
      file: '.gitleaks.toml',
      rules: [rule('title', /^(title = ")[^"]*(")$/m, between(id.slug))],
    },
    {
      file: 'src/lib/query-client.ts',
      rules: [rule('persister key', `'${TEMPLATE.slug}-query-cache'`, `'${id.slug}-query-cache'`)],
    },
    {
      file: 'scripts/repo-settings.js',
      rules: [
        rule(
          'environment reviewers',
          /(reviewers: \[\{ type: 'User', login: ')[^']*('\ \}\])/g,
          between(id.githubRepo.split('/')[0]),
          2,
        ),
      ],
    },
    {
      file: '.maestro/config.yaml',
      rules: [rule('MAESTRO_APP_ID example', `${TEMPLATE.package}.dev`, `${id.package}.dev`)],
    },
    { file: '.eas/workflows/e2e.yml', rules: [...maestroAppId, ...workflowUrls] },
    { file: '.eas/workflows/e2e-quarantine.yml', rules: maestroAppId },
    { file: '.eas/workflows/deploy-staging.yml', rules: workflowUrls },
    { file: '.eas/workflows/promote.yml', rules: workflowUrls },
    { file: '.eas/workflows/release.yml', rules: workflowUrls },
    {
      file: 'docs/environments-and-secrets.md',
      rules: [
        rule(
          'credentials table (Android rows)',
          /^(\| Android {2}\|[^\n]*?`)com\.seandillon\.expoboilerplate/gm,
          after(id.package),
          5,
        ),
        rule(
          'Play package',
          /(with package\n\s+`)com\.seandillon\.expoboilerplate/g,
          after(id.package),
        ),
        rule('bundle id (iOS rows, Apple runbook)', TEMPLATE.bundleId, id.bundleId, 8),
        rule(
          'EAS project id prefix',
          '`885fa7d0-…`',
          easId ? `\`${easId.slice(0, 8)}-…\`` : '(unset)',
        ),
        rule('dev-domain', `--dev-domain ${TEMPLATE.slug}`, `--dev-domain ${id.slug}`),
        ...workflowUrls,
      ],
    },
    {
      file: 'docs/release-ladder.md',
      rules: [rule('dev-domain', `--dev-domain ${TEMPLATE.slug}`, `--dev-domain ${id.slug}`)],
    },
    {
      file: 'docs/build-sharing.md',
      rules: [
        rule(
          'staging web URL',
          `${TEMPLATE.slug}--staging.expo.app`,
          `${id.slug}--staging.expo.app`,
        ),
      ],
    },
    {
      file: 'docs/device-onboarding.md',
      rules: [rule('bundle id', TEMPLATE.bundleId, id.bundleId)],
    },
    {
      file: 'docs/native-e2e.md',
      rules: [
        rule('expo.dev project name', `project **${TEMPLATE.slug}**`, `project **${id.slug}**`, 2),
        rule('GitHub repo', TEMPLATE.githubRepo, id.githubRepo),
      ],
    },
    {
      file: 'docs/rozenite.md',
      rules: [rule('npm scope example', `@${TEMPLATE.slug}/`, `@${id.slug}/`, 3)],
    },
  ];
}

/**
 * Template identifiers that intentionally survive init, as `file: reason`. The leftover scan
 * skips these; everything else it finds is reported so the owner can decide.
 */
const KEEP = Object.freeze({
  'PLAN.md': 'the template design document (#54 decides its fate)',
  'docs/performance.md': 'links the upstream research issue (#63) on the template repo',
  'scripts/init.js': 'the template identity this script matches on (#54 self-deletes it)',
  'scripts/__tests__/init.test.ts': 'the drift guard for this script (#54 removes it)',
});

/** Files the leftover scan never reads. */
const SCAN_SKIP = [/^\.claude\//, /^bun\.lock$/, /^assets\//, /^CHANGELOG\.md$/];

/** Applies `rules` in order; returns the new content and the match count per rule. */
function applyRules(content, rules) {
  const counts = [];
  let out = content;
  for (const r of rules) {
    let count;
    if (typeof r.find === 'string') {
      count = out.split(r.find).length - 1;
      out = out.split(r.find).join(r.replace);
    } else {
      count = [
        ...out.matchAll(r.find.global ? r.find : new RegExp(r.find.source, `${r.find.flags}g`)),
      ].length;
      out = out.replace(r.find, (...m) => r.replace(m));
    }
    counts.push({ id: r.id, count, min: r.min });
  }
  return { content: out, counts };
}

/**
 * Runs the manifest against `read(file)` without writing. Throws (listing every miss) when any
 * rule matched fewer times than it expects — the drift protection.
 */
function plan(identity, read) {
  const misses = [];
  const changes = [];
  for (const entry of buildManifest(identity)) {
    const before = read(entry.file);
    if (before === null) {
      misses.push(`${entry.file}: file not found`);
      continue;
    }
    const { content, counts } = applyRules(before, entry.rules);
    for (const c of counts) {
      if (c.count < c.min)
        misses.push(`${entry.file}: "${c.id}" matched ${c.count}× (expected ≥ ${c.min})`);
    }
    changes.push({ file: entry.file, before, after: content, counts });
  }
  if (misses.length) {
    throw new Error(
      `init: the template moved out from under the manifest — fix scripts/init.js:\n  ${misses.join('\n  ')}`,
    );
  }
  return changes;
}

/** Line diff for the dry-run output; rewrites never add or remove lines. */
function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length !== b.length) return [`- (${a.length} lines)`, `+ (${b.length} lines)`];
  const out = [];
  a.forEach((line, i) => {
    if (line !== b[i]) out.push(`@@ ${i + 1}`, `- ${line}`, `+ ${b[i]}`);
  });
  return out;
}

/** Old identifiers still present in `files` (`{ path: content }`), excluding KEEP and SCAN_SKIP. */
function scanLeftovers(files, template = TEMPLATE) {
  const tokens = [
    ...new Set([
      template.name,
      template.slug,
      template.bundleId,
      template.package,
      template.easProjectId,
      template.owner,
    ]),
  ];
  const hits = [];
  for (const [file, content] of Object.entries(files)) {
    if (KEEP[file] || SCAN_SKIP.some((re) => re.test(file))) continue;
    content.split('\n').forEach((line, i) => {
      const token = tokens.find((t) => line.includes(t));
      if (token) hits.push({ file, line: i + 1, token, text: line.trim().slice(0, 100) });
    });
  }
  return hits;
}

/* ------------------------------------------------------------------------------------------ */
/* Steps                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * Ordered steps; each gets `{ root, identity, dryRun, log, results }` and may declare
 * `when({ args })` to opt out. Later tickets append to this list: #54 reset ledger / clear
 * changelog / fresh git history / self-delete, #55 repo settings.
 */
const steps = [
  // Fails init (nothing written) when Bun / Node / git are missing; `--skip-doctor` skips it.
  doctorStep,
  {
    id: 'rewrite',
    title: 'Rewrite template identifiers',
    run({ root, identity, dryRun, log }) {
      const read = (file) => {
        const abs = path.join(root, file);
        return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      };
      const changes = plan(identity, read);
      if (dryRun) {
        for (const change of changes) {
          const diff = diffLines(change.before, change.after);
          if (diff.length) log(`--- ${change.file}\n${diff.join('\n')}`);
        }
      } else {
        const written = changes.filter((c) => c.after !== c.before).map((c) => c.file);
        for (const change of changes) {
          if (change.after !== change.before)
            fs.writeFileSync(path.join(root, change.file), change.after);
        }
        // Markdown table columns and wrapped lines move when a value changes length; the gate's
        // `Format` check would fail on the first commit otherwise. bunx resolves the repo-pinned
        // prettier once `bun install` has run; before that, `bun run format` fixes it up.
        const prettier = spawnSync(
          'bunx',
          ['prettier', '--write', '--ignore-unknown', '--log-level', 'warn', ...written],
          {
            cwd: root,
            encoding: 'utf8',
          },
        );
        if (prettier.status !== 0) {
          log(
            `  prettier did not run (${(prettier.stderr || prettier.error?.message || '').trim()}); run \`bun run format\` before committing.`,
          );
        }
      }
      const width = Math.max(...changes.map((c) => c.file.length));
      log(`\n${dryRun ? 'Would rewrite' : 'Rewrote'}:`);
      for (const change of changes) {
        const total = change.counts.reduce((n, c) => n + c.count, 0);
        log(
          `  ${change.file.padEnd(width)}  ${String(total).padStart(3)}×  ${change.counts.map((c) => c.id).join(', ')}`,
        );
      }
      return { files: changes.map((c) => c.file) };
    },
  },
  {
    id: 'scan',
    title: 'Scan for leftover template identifiers',
    run({ root, dryRun, log, results }) {
      const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
      if (ls.status !== 0) {
        log('\nLeftover scan skipped (not a git checkout).');
        return { hits: [] };
      }
      const rewritten = new Set(results.rewrite?.files ?? []);
      const files = {};
      for (const file of ls.stdout.split('\0').filter(Boolean)) {
        // In a dry run the rewritten files are unchanged on disk; skip them rather than report
        // the very identifiers the rewrite step just planned to replace.
        if (dryRun && rewritten.has(file)) continue;
        const abs = path.join(root, file);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        files[file] = fs.readFileSync(abs, 'utf8');
      }
      const hits = scanLeftovers(files);
      if (hits.length) {
        log('\nTemplate identifiers still present (review by hand):');
        for (const h of hits) log(`  ${h.file}:${h.line}  ${h.token}  ${h.text}`);
      }
      log(
        `\nKept on purpose: ${Object.entries(KEEP)
          .map(([f, why]) => `${f} (${why})`)
          .join('; ')}.`,
      );
      return { hits };
    },
  },
];

/* ------------------------------------------------------------------------------------------ */
/* CLI                                                                                         */
/* ------------------------------------------------------------------------------------------ */

function usage() {
  const flags = FIELDS.map((f) => `  --${f.flag.padEnd(16)} ${f.label}`).join('\n');
  return `Usage: bun run init [--yes] [--dry-run] [--skip-doctor] [flags]\n\n${flags}\n  --yes              no prompts: flags + derived defaults\n  --dry-run          print the diff and summary, write nothing\n  --skip-doctor      skip the toolchain check (bun run doctor)\n\nSee docs/template-init.md.`;
}

async function collectIdentity(args, { interactive, root, log }) {
  const defaults = deriveDefaults(path.basename(root));
  const answers = {};
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  try {
    for (const field of FIELDS) {
      const fallback = field.defaultFrom(defaults, answers);
      if (args[field.flag] !== undefined) {
        answers[field.key] = args[field.flag];
        continue;
      }
      if (!interactive) {
        answers[field.key] = fallback;
        continue;
      }
      for (;;) {
        const raw = (await rl.question(`${field.label}\n  [${fallback || 'empty'}] > `)).trim();
        const value = raw === '' ? fallback : raw;
        const problem = field.validate(value);
        if (!problem) {
          answers[field.key] = value;
          break;
        }
        log(`  ✗ ${problem}`);
      }
    }
  } finally {
    rl?.close();
  }
  return answers;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const root = process.cwd();
  const log = (line) => console.log(line);
  const interactive = !args.yes && process.stdin.isTTY;
  const identity = await collectIdentity(args, { interactive, root, log });
  const errors = validateIdentity(identity);
  if (Object.keys(errors).length) {
    console.error('init: invalid values:');
    for (const [key, message] of Object.entries(errors)) {
      const flag = FIELDS.find((f) => f.key === key).flag;
      console.error(`  --${flag} (${JSON.stringify(identity[key] ?? '')}): ${message}`);
    }
    return 1;
  }

  log(
    `${args['dry-run'] ? '[dry run] ' : ''}Initialising ${identity.name} (${identity.slug}) in ${root}`,
  );
  const results = {};
  for (const step of steps) {
    if (step.when && !step.when({ args })) continue;
    log(`\n▶ ${step.title}`);
    results[step.id] = await step.run({
      root,
      identity,
      dryRun: Boolean(args['dry-run']),
      log,
      results,
    });
  }

  if (!identity.easProjectId) {
    log(
      '\nNo EAS project id: EAS Update, Observe and the workflows stay unlinked until you run ' +
        '`bun run eas init` and paste the id into EAS_PROJECT_ID in app.config.ts.',
    );
  }
  log(
    `\nNext: bun install && bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check` +
      `\nThen: bun run repo:settings:apply (#55), commit. See docs/template-init.md.`,
  );
  return 0;
}

module.exports = {
  FIELDS,
  KEEP,
  TEMPLATE,
  applyRules,
  buildManifest,
  deriveDefaults,
  diffLines,
  parseArgs,
  plan,
  scanLeftovers,
  steps,
  validateIdentity,
};

if (require.main === module) {
  // `exitCode`, not `process.exit()`: Bun (which `bun run` substitutes for node) can drop piped
  // stdout that has not flushed when exit() is called.
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
