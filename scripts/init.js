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
 *   bun run init --fresh-git ...       # rm -rf .git, one initial commit (prompted otherwise; default No)
 *   bun run init --keep-init ...       # keep this script, its test and doc (default: self-delete)
 *   bun run init --keep-plan ...       # keep PLAN.md as is (default: stub pointing at the upstream plan)
 *   bun run init --apply-repo-settings # run `bun run repo:settings:apply` at the end (prompted otherwise;
 *                                      #   default No; needs `gh auth` + an `origin` remote)
 *
 * Design:
 *   - `MANIFEST` lists every (file, pattern) init touches. A pattern that matches fewer times than
 *     expected fails the run before anything is written, so a later ticket that moves an identifier
 *     breaks `scripts/__tests__/init.test.ts` (the drift guard) instead of silently leaving it behind.
 *   - After rewriting, tracked files are scanned for leftover template identifiers; hits are
 *     reported as warnings (never failures) and `KEEP` lists the ones that are intentional.
 *   - `steps` is the ordered list of what init does: the toolchain check (#53, `scripts/doctor.js`),
 *     rewrite + scan, then (#54) reset the queue ledger, stub PLAN.md, clear the changelog,
 *     reset versioning to 1.0.0 (#60, release-please), self-delete, and — last, so the initial
 *     commit holds the final tree — fresh git history.
 *     A step's optional `when({ args })` can opt it out. The last step (#55) applies the GitHub
 *     repo settings (`scripts/repo-settings.js`) when asked to.
 *   - `REMOVAL` is the self-delete manifest: the files and lines that only make sense in the
 *     template. Like `MANIFEST`, every entry must match on main (same drift guard).
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

const BOOLEAN_FLAGS = [
  'yes',
  'dry-run',
  'skip-doctor',
  'fresh-git',
  'keep-init',
  'keep-plan',
  'apply-repo-settings',
  'help',
];
const FLAGS = new Set([...FIELDS.map((f) => f.flag), ...BOOLEAN_FLAGS]);

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
    if (BOOLEAN_FLAGS.includes(flag)) {
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
      // `after.` in e2e.yml / e2e-quarantine.yml (their maestro jobs depend via `after:`),
      // `needs.` in e2e-cloud.yml (`needs: [repack_ios]`) — both spellings match.
      /(MAESTRO_APP_ID: )\S+(\n\s+params:\n\s+build_id: \$\{\{ (?:needs|after)\.repack_ios)/g,
      between(`${id.bundleId}.dev`),
    ),
    rule(
      'MAESTRO_APP_ID (Android job)',
      /(MAESTRO_APP_ID: )\S+(\n\s+params:\n\s+build_id: \$\{\{ (?:needs|after)\.repack_android)/g,
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
        rule(
          'badge repo',
          `github.com/${TEMPLATE.githubRepo}/actions`,
          `github.com/${id.githubRepo}/actions`,
        ),
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
    // Same two MAESTRO_APP_ID values; the `proj_REPLACE_ME` Maestro Cloud project id placeholder is
    // not a template identity and stays (docs/native-e2e.md → Maestro Cloud).
    { file: '.eas/workflows/e2e-cloud.yml', rules: maestroAppId },
    { file: '.eas/workflows/deploy-staging.yml', rules: workflowUrls },
    { file: '.eas/workflows/promote.yml', rules: workflowUrls },
    { file: '.eas/workflows/release.yml', rules: workflowUrls },
    { file: '.eas/workflows/rollout.yml', rules: workflowUrls },
    { file: '.eas/workflows/backport.yml', rules: workflowUrls },
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
  'PLAN.md': 'replaced by a stub that links the upstream plan (--keep-plan keeps it)',
  'docs/performance.md': 'links the upstream research issue (#63) on the template repo',
  'README.md': 'links the upstream deferred-ticket issues under "Commonly added next"',
  'scripts/init.js':
    'the template identity this script matches on (self-deleted unless --keep-init)',
  'scripts/__tests__/init.test.ts': 'the drift guard for this script (removed with it)',
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
/* Reset: queue ledger, PLAN.md stub, changelog                                                */
/* ------------------------------------------------------------------------------------------ */

const UPSTREAM_URL = `https://github.com/${TEMPLATE.githubRepo}`;
const LEDGER_PATH = '.claude/execution-queue.md';

/**
 * The ledger's fixed header lines. The drift guard asserts the template's own ledger still
 * carries them verbatim, so the reset template and `/ship-next` never disagree on the format.
 */
const LEDGER_LEGEND =
  'Legend: `[ ]` pending · `[x]` shipped · `[M]` manual/human · `[B]` blocked · `[D]` deferred · `[S]` needs secrets';
const LEDGER_RULE =
  'Rule: one ticket per PR, branch off `main`, squash-merge immediately, close the issue on merge. Fresh subagent per ticket.';

const today = () => new Date().toISOString().slice(0, 10);

/** An empty ledger for the new project: same header, no tickets, a run log with the init line. */
function buildLedger(identity, date = today()) {
  return [
    `# Execution Queue — ${identity.slug}`,
    '',
    `**Source of truth for \`/ship-next\`.** Tracker: GitHub Issues in \`${identity.githubRepo}\`. Plan: \`PLAN.md\`.`,
    '',
    LEDGER_LEGEND,
    '',
    LEDGER_RULE,
    '',
    '## OPEN QUEUE (dependency order)',
    '',
    '_Empty. Add one `### E<n> — <epic> (tracker #<issue>)` heading per epic and one_',
    '_`- [ ] **#<issue> T<n>.<m>** — <summary>` line per ticket, in dependency order._',
    '',
    '## RUN LOG',
    '',
    `- ${date} — Initialised from ${TEMPLATE.githubRepo} (\`bun run init\`).`,
    '',
  ].join('\n');
}

const PLAN_DECISIONS_HEADING = '## Locked decisions';

/**
 * PLAN.md for the new project: a short header, then the template's "Locked decisions" section
 * kept verbatim (CLAUDE.md and docs/ cite "PLAN.md decision N" by number) and a link to the
 * upstream plan for the epics, tickets and definition of done that only concern the template.
 */
function buildPlanStub(identity, templatePlan) {
  const start = templatePlan.indexOf(`${PLAN_DECISIONS_HEADING}\n`);
  if (start === -1) throw new Error(`init: PLAN.md has no "${PLAN_DECISIONS_HEADING}" section`);
  const rest = templatePlan.slice(start + PLAN_DECISIONS_HEADING.length + 1);
  const next = rest.search(/^## /m);
  const decisions = (next === -1 ? rest : rest.slice(0, next)).trim();
  return [
    `# Plan — ${identity.name}`,
    '',
    `Design decisions and the ticket breakdown for ${identity.name} live here; the queue is`,
    '`.claude/execution-queue.md` and `/ship-next` works it.',
    '',
    `Created from [expo-boilerplate](${UPSTREAM_URL}) with \`bun run init\`. The decisions below are`,
    'inherited from the template (`CLAUDE.md` and `docs/` cite them as "PLAN.md decision N"); the',
    `template's own epics, tickets and definition of done stay upstream at`,
    `${UPSTREAM_URL}/blob/main/PLAN.md.`,
    '',
    `${PLAN_DECISIONS_HEADING} (inherited)`,
    '',
    decisions,
    '',
  ].join('\n');
}

/** A fresh CHANGELOG.md; only written when the template ships one (release-please, #60). */
function buildChangelog(identity) {
  return `# Changelog\n\nAll notable changes to ${identity.name} are documented here.\n`;
}

/* ------------------------------------------------------------------------------------------ */
/* Versioning reset (release-please, #60 / ADR-0002)                                           */
/* ------------------------------------------------------------------------------------------ */

const RELEASE_PLEASE_CONFIG = 'release-please-config.json';
const RELEASE_PLEASE_MANIFEST = '.release-please-manifest.json';
const INITIAL_VERSION = '1.0.0';
const PACKAGE_VERSION_RE = /^( {2}"version": ")[^"]*(",)$/m;

/**
 * The new project starts at 1.0.0 whatever the template has released by now: the manifest and
 * `package.json` `version` (which app.config.ts reads) are reset, and the template's
 * `last-release-sha` — "everything up to here is already released" — is dropped for a fresh
 * history or pointed at `headSha` (the current HEAD) so the inherited history is never released
 * retroactively. Throws on drift, like the manifests.
 */
function resetVersioning({ config, manifest, packageJson, headSha }) {
  const { 'last-release-sha': _previous, $schema, ...rest } = JSON.parse(config);
  const nextConfig = {
    ...($schema ? { $schema } : {}),
    ...(headSha ? { 'last-release-sha': headSha } : {}),
    ...rest,
  };
  if (!Object.keys(JSON.parse(manifest)).includes('.')) {
    throw new Error(`init: ${RELEASE_PLEASE_MANIFEST} has no "." package — fix scripts/init.js`);
  }
  if (!PACKAGE_VERSION_RE.test(packageJson)) {
    throw new Error('init: package.json has no "version" line — fix scripts/init.js');
  }
  return {
    config: `${JSON.stringify(nextConfig, null, 2)}\n`,
    manifest: `${JSON.stringify({ '.': INITIAL_VERSION }, null, 2)}\n`,
    packageJson: packageJson.replace(PACKAGE_VERSION_RE, `$1${INITIAL_VERSION}$2`),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Self-delete manifest                                                                        */
/* ------------------------------------------------------------------------------------------ */

/**
 * What only makes sense while this checkout is the template: the init script, its drift-guard
 * test and doc, and every line that points at them. `bun run doctor` (and its test and doc)
 * stays — it is useful in the project. Each `edits` rule must match (min 1) on main; the drift
 * guard runs them against the real files, like `buildManifest`.
 */
const REMOVAL = Object.freeze({
  files: [
    'scripts/init.js',
    'scripts/__tests__/init.test.ts',
    'docs/template-init.md',
    // The template end-to-end test (#56) only makes sense on the template itself.
    'scripts/template-e2e.js',
  ],
  edits: [
    {
      file: 'package.json',
      rules: [
        rule('init script', /^ {4}"init": "node scripts\/init\.js",\n/gm, () => ''),
        rule(
          'template:e2e script',
          /^ {4}"template:e2e": "node scripts\/template-e2e\.js",\n/gm,
          () => '',
        ),
      ],
    },
    {
      file: 'README.md',
      rules: [
        rule('quick start line', /^bun run init +# [^\n]*\n/gm, () => ''),
        rule(
          'docs list entry',
          /^- \[Template init\]\(docs\/template-init\.md\)[^\n]*\n/gm,
          () => '',
        ),
      ],
    },
    {
      file: 'CLAUDE.md',
      rules: [
        rule('init command bullet', /^- `bun run init` — [^\n]*\n/gm, () => ''),
        rule('template:e2e command bullet', /^- `bun run template:e2e` — [^\n]*\n/gm, () => ''),
        rule(
          'doctor bullet: init step',
          / Also the first `init` step \(`--skip-doctor`\)\./g,
          () => '',
        ),
        rule('ci bullet: template init job', /, template init(?=\))/g, () => ''),
      ],
    },
    {
      // The `Template init` job (and its required check) exist only on the template. The job is
      // the last one in the file: the rule takes the blank line before it and everything indented
      // under it, so the file still ends with a single newline.
      file: '.github/workflows/ci.yml',
      rules: [
        rule('template-init job', /^\n {2}template-init:\n(?:(?: {4}[^\n]*)?\n)*/m, () => ''),
      ],
    },
    {
      file: 'scripts/repo-settings.js',
      rules: [rule('Template init required check', /^ {2}'Template init',\n/gm, () => '')],
    },
    {
      file: 'docs/js-gate.md',
      rules: [
        rule('checks table row', /^\| `Template init` +\|[^\n]*\n/gm, () => ''),
        rule(
          'slowest-job paragraph',
          /^`Template init` is the slowest job[^\n]*\n(?:[^\n]+\n)*\n/m,
          () => '',
        ),
        rule('local table row', /^\| Template init +\|[^\n]*\n/gm, () => ''),
      ],
    },
    {
      file: 'docs/doctor.md',
      rules: [
        rule(
          'init step sentence',
          /It is also the first `init`\nstep \(`--skip-doctor` to skip\)\. /g,
          () => '',
        ),
      ],
    },
  ],
});

/** Line-removal edits for the self-delete step; throws (listing every miss) on drift. */
function planRemoval(read) {
  const misses = [];
  const changes = [];
  for (const file of REMOVAL.files) {
    if (read(file) === null) misses.push(`${file}: file not found`);
  }
  for (const entry of REMOVAL.edits) {
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
      `init: the self-delete manifest drifted — fix REMOVAL in scripts/init.js:\n  ${misses.join('\n  ')}`,
    );
  }
  return changes;
}

/** Initial-commit subject for a fresh history; the slug keeps it commitlint-lowercase. */
const initialCommitMessage = (identity) =>
  `chore: initialize ${identity.slug} from ${TEMPLATE.slug}`;

/** Runs a git command in `root`; returns `{ ok, out }`. */
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/**
 * Uncommitted changes in `root` (`git status --porcelain` lines), or `null` when it is not a git
 * checkout. Taken before any step writes, so `--fresh-git` can refuse to wipe history that holds
 * someone's work rather than init's own edits.
 */
function uncommittedChanges(root) {
  if (!git(root, ['rev-parse', '--is-inside-work-tree']).ok) return null;
  const status = git(root, ['status', '--porcelain']);
  return status.ok ? status.out.split('\n').filter(Boolean) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Steps                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Writes `content` to `file` under `root` unless dry-running. */
function writeOrPlan(root, file, content, dryRun) {
  if (!dryRun) fs.writeFileSync(path.join(root, file), content);
}

/**
 * Ordered steps; each gets `{ root, identity, dryRun, log, results, args }` and may declare
 * `when({ args })` to opt out. Every step returns `{ summary }` (plus whatever later steps need)
 * for the closing table.
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
      return { files: changes.map((c) => c.file), summary: `${changes.length} files` };
    },
  },
  {
    id: 'scan',
    title: 'Scan for leftover template identifiers',
    run({ root, dryRun, log, results }) {
      const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
      if (ls.status !== 0) {
        log('\nLeftover scan skipped (not a git checkout).');
        return { hits: [], summary: 'skipped (not a git checkout)' };
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
      return { hits, summary: hits.length ? `${hits.length} to review by hand` : 'clean' };
    },
  },
  {
    id: 'ledger',
    title: 'Reset the queue ledger',
    run({ root, identity, dryRun, log }) {
      writeOrPlan(root, LEDGER_PATH, buildLedger(identity), dryRun);
      log(
        `  ${dryRun ? 'Would reset' : 'Reset'} ${LEDGER_PATH} (empty queue, tracker ${identity.githubRepo}).`,
      );
      return { summary: 'empty queue' };
    },
  },
  {
    id: 'plan',
    title: 'Replace PLAN.md with a stub',
    when: ({ args }) => !args['keep-plan'],
    run({ root, identity, dryRun, log }) {
      const abs = path.join(root, 'PLAN.md');
      if (!fs.existsSync(abs)) {
        log('  No PLAN.md, skipped.');
        return { summary: 'no PLAN.md, skipped' };
      }
      writeOrPlan(root, 'PLAN.md', buildPlanStub(identity, fs.readFileSync(abs, 'utf8')), dryRun);
      log(
        `  ${dryRun ? 'Would replace' : 'Replaced'} PLAN.md: inherited decisions + link to ${UPSTREAM_URL} (--keep-plan keeps the original).`,
      );
      return { summary: 'stub with inherited decisions' };
    },
  },
  {
    id: 'changelog',
    title: 'Clear the changelog',
    run({ root, identity, dryRun, log }) {
      if (!fs.existsSync(path.join(root, 'CHANGELOG.md'))) {
        log('  No CHANGELOG.md, skipped.');
        return { summary: 'no CHANGELOG.md, skipped' };
      }
      writeOrPlan(root, 'CHANGELOG.md', buildChangelog(identity), dryRun);
      log(`  ${dryRun ? 'Would replace' : 'Replaced'} CHANGELOG.md with a fresh header.`);
      return { summary: 'fresh header' };
    },
  },
  {
    id: 'versioning',
    title: 'Reset versioning to 1.0.0',
    run({ root, dryRun, log, args }) {
      const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
      // A fresh history has no commit to point at; otherwise the current HEAD (the last commit
      // of the inherited history) is the marker, and the init commit is the first one counted.
      const head = args['fresh-git'] ? null : git(root, ['rev-parse', 'HEAD']);
      const headSha = head?.ok ? head.out : null;
      const next = resetVersioning({
        config: read(RELEASE_PLEASE_CONFIG),
        manifest: read(RELEASE_PLEASE_MANIFEST),
        packageJson: read('package.json'),
        headSha,
      });
      writeOrPlan(root, RELEASE_PLEASE_CONFIG, next.config, dryRun);
      writeOrPlan(root, RELEASE_PLEASE_MANIFEST, next.manifest, dryRun);
      writeOrPlan(root, 'package.json', next.packageJson, dryRun);
      const marker = headSha
        ? `last-release-sha = ${headSha.slice(0, 7)} (current HEAD)`
        : 'last-release-sha dropped (fresh history)';
      log(
        `  ${dryRun ? 'Would reset' : 'Reset'} ${RELEASE_PLEASE_MANIFEST} and package.json version to ${INITIAL_VERSION}; ${marker} in ${RELEASE_PLEASE_CONFIG}.`,
      );
      return { summary: `${INITIAL_VERSION}, ${marker}` };
    },
  },
  {
    id: 'self-delete',
    title: 'Remove the init script',
    when: ({ args }) => !args['keep-init'],
    run({ root, dryRun, log }) {
      const read = (file) => {
        const abs = path.join(root, file);
        return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      };
      const edits = planRemoval(read);
      const verb = dryRun ? 'Would remove' : 'Removed';
      for (const file of REMOVAL.files) {
        if (!dryRun) fs.rmSync(path.join(root, file));
        log(`  ${verb} ${file}`);
      }
      for (const edit of edits) {
        writeOrPlan(root, edit.file, edit.after, dryRun);
        log(`  ${verb} from ${edit.file}: ${edit.counts.map((c) => c.id).join(', ')}`);
      }
      log('  Kept scripts/doctor.js, its test and `bun run doctor` (--keep-init keeps init too).');
      return {
        files: REMOVAL.files,
        summary: `${REMOVAL.files.length} files removed, ${edits.length} edited`,
      };
    },
  },
  {
    id: 'fresh-git',
    title: 'Fresh git history',
    when: ({ args }) => Boolean(args['fresh-git']),
    run({ root, identity, dryRun, log }) {
      const message = initialCommitMessage(identity);
      if (dryRun) {
        log(`  Would rm -rf .git, git init -b main, and commit everything as "${message}".`);
        return { summary: 'would re-init with one commit' };
      }
      fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
      const recover = `recover with: git init -b main && git add -A && git commit -m "${message}"`;
      for (const cmd of [
        ['init', '-b', 'main'],
        ['add', '-A'],
        ['commit', '-q', '-m', message],
      ]) {
        const r = git(root, cmd);
        if (!r.ok) throw new Error(`init: git ${cmd[0]} failed (${r.out}); ${recover}`);
      }
      log(`  Re-initialised .git on main with one commit: "${message}".`);
      // .git/hooks went with the old history; lefthook (the `prepare` script) writes them back.
      const hooks = spawnSync('bunx', ['lefthook', 'install'], { cwd: root, encoding: 'utf8' });
      if (hooks.status === 0) log('  Reinstalled lefthook hooks.');
      else
        log('  lefthook hooks not installed (run `bun install`, which runs `lefthook install`).');
      log(
        `  Next: git remote add origin git@github.com:${identity.githubRepo}.git && git push -u origin main`,
      );
      return { summary: `1 commit, hooks ${hooks.status === 0 ? 'installed' : 'pending'}` };
    },
  },
  {
    // Opt-in and last: branch protection, merge settings, environments and labels need the repo
    // to exist on GitHub. Skipped (with the manual command) when `gh` is not logged in or there
    // is no `origin` — which is always the case right after `--fresh-git`.
    id: 'repo-settings',
    title: 'Apply GitHub repo settings',
    when: ({ args }) => Boolean(args['apply-repo-settings']),
    run({ root, dryRun, log }) {
      const skip = repoSettingsBlocker(root);
      if (skip) {
        log(`  Skipped: ${skip}.\n  ${REPO_SETTINGS_HINT}`);
        return { summary: `skipped (${skip})` };
      }
      if (dryRun) {
        log(
          '  Would run: bun run repo:settings:apply (branch protection, merge settings, environments, labels).',
        );
        return { summary: 'would apply' };
      }
      const r = spawnSync(process.execPath, ['scripts/repo-settings.js', '--apply'], {
        cwd: root,
        encoding: 'utf8',
      });
      const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
      if (out) log(out.replace(/^/gm, '  '));
      if (r.status !== 0) {
        throw new Error(
          `init: repo:settings:apply failed (exit ${r.status}); ${REPO_SETTINGS_HINT}`,
        );
      }
      return { summary: 'applied' };
    },
  },
];

const REPO_SETTINGS_HINT =
  'push to GitHub, then run: bun run repo:settings:apply (docs/js-gate.md)';

/** Why `repo:settings:apply` cannot run right now (null = it can): needs `gh auth` and `origin`. */
function repoSettingsBlocker(root) {
  const auth = spawnSync('gh', ['auth', 'status'], { cwd: root, encoding: 'utf8' });
  if (auth.error) return 'gh is not installed';
  if (auth.status !== 0) return 'gh is not logged in (gh auth login)';
  if (!git(root, ['remote', 'get-url', 'origin']).ok) return 'no `origin` remote';
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* CLI                                                                                         */
/* ------------------------------------------------------------------------------------------ */

function usage() {
  const flags = FIELDS.map((f) => `  --${f.flag.padEnd(16)} ${f.label}`).join('\n');
  return [
    'Usage: bun run init [--yes] [--dry-run] [--skip-doctor] [--fresh-git] [--keep-init] [--keep-plan] [--apply-repo-settings] [flags]',
    '',
    flags,
    '  --yes              no prompts: flags + derived defaults',
    '  --dry-run          print the diff and summary, write nothing',
    '  --skip-doctor      skip the toolchain check (bun run doctor)',
    '  --fresh-git        rm -rf .git and make one initial commit (asked interactively; default No)',
    '  --keep-init        keep scripts/init.js, its test and doc (default: self-delete)',
    '  --keep-plan        keep PLAN.md as is (default: stub with the inherited decisions)',
    '  --apply-repo-settings  run bun run repo:settings:apply at the end (asked interactively; default No)',
    '',
    'See docs/template-init.md.',
  ].join('\n');
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

  const dryRun = Boolean(args['dry-run']);
  if (interactive && !dryRun) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const yes = async (question) => /^y(es)?$/i.test((await rl.question(question)).trim());
    try {
      if (!args['fresh-git']) {
        args['fresh-git'] = await yes(
          'Start a fresh git history (rm -rf .git, one initial commit)?\n  [y/N] > ',
        );
      }
      // A fresh history drops `origin`, so the settings step would only skip itself.
      if (!args['apply-repo-settings'] && !args['fresh-git']) {
        args['apply-repo-settings'] = await yes(
          'Apply the GitHub repo settings now (branch protection, merge settings, environments, labels via gh)?\n  [y/N] > ',
        );
      }
    } finally {
      rl.close();
    }
  }
  // Before anything is written: a fresh history must not swallow uncommitted work.
  if (args['fresh-git'] && !dryRun) {
    const dirty = uncommittedChanges(root);
    if (dirty && dirty.length) {
      console.error(
        `init: --fresh-git refused, the working tree has uncommitted changes (commit or stash them first):\n  ${dirty.join('\n  ')}`,
      );
      return 1;
    }
  }

  log(`${dryRun ? '[dry run] ' : ''}Initialising ${identity.name} (${identity.slug}) in ${root}`);
  const results = {};
  for (const step of steps) {
    if (step.when && !step.when({ args })) continue;
    log(`\n▶ ${step.title}`);
    results[step.id] = await step.run({ root, identity, dryRun, log, results, args });
  }

  log(`\n${dryRun ? 'Would do' : 'Done'}:`);
  const width = Math.max(...steps.map((s) => s.title.length));
  for (const step of steps) {
    const outcome = results[step.id] ? (results[step.id].summary ?? 'done') : 'skipped';
    log(`  ${step.title.padEnd(width)}  ${outcome}`);
  }

  if (!identity.easProjectId) {
    log(
      '\nNo EAS project id: EAS Update, Observe and the workflows stay unlinked until you run ' +
        '`bun run eas init` and paste the id into EAS_PROJECT_ID in app.config.ts.',
    );
  }
  log(
    `\nNext: bun install && bun run lint && bun run typecheck && bun run test && bun run knip && bun run i18n:check` +
      (results['repo-settings']?.summary === 'applied' ? '' : `\nThen ${REPO_SETTINGS_HINT}`) +
      (args['fresh-git']
        ? ''
        : `, then commit: git add -A && git commit -m "${initialCommitMessage(identity)}"`) +
      (args['keep-init'] ? '. See docs/template-init.md.' : '.'),
  );
  return 0;
}

module.exports = {
  FIELDS,
  INITIAL_VERSION,
  KEEP,
  LEDGER_LEGEND,
  LEDGER_PATH,
  LEDGER_RULE,
  PLAN_DECISIONS_HEADING,
  RELEASE_PLEASE_CONFIG,
  RELEASE_PLEASE_MANIFEST,
  REMOVAL,
  TEMPLATE,
  applyRules,
  buildChangelog,
  buildLedger,
  buildManifest,
  buildPlanStub,
  deriveDefaults,
  diffLines,
  initialCommitMessage,
  parseArgs,
  plan,
  planRemoval,
  resetVersioning,
  scanLeftovers,
  steps,
  uncommittedChanges,
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
