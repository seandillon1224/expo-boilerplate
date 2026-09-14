#!/usr/bin/env node
/**
 * GitHub repo settings as code: `main` branch protection (required checks), the merge settings
 * Renovate `platformAutomerge` needs, the `uat` / `production` deployment environments with
 * required reviewers, the labels the automation relies on, and GitHub Pages sourced from Actions
 * (the docs site). Plain Node/JS, shells out to `gh api`.
 *
 * Usage (needs `gh auth login` with admin on the repo):
 *   bun run repo:settings          # --dry-run (default): print the gh api calls + payloads, no writes
 *   bun run repo:settings:apply    # --apply: PUT branch protection + PATCH repo + PUT environments
 *                                  #          + POST/PATCH labels + POST/PUT pages
 *   bun run repo:settings:check    # --check: GET current state, diff against DESIRED, exit 1 on drift
 *   ... --only labels,repo         # any mode: run a subset of protection | repo | environments | labels | pages
 *
 * Run `:apply` once after creating a repo from this template (the init script's `--apply-repo-settings`
 * does it for you), and again whenever DESIRED changes. There is no CI drift guard: the Actions
 * `GITHUB_TOKEN` cannot read branch protection.
 *
 * The repo is whatever `gh repo view` resolves: the `origin` remote of the current checkout, or
 * `GH_REPO=owner/name` to override. `gh auth status` must pass before anything runs.
 *
 * Why classic protection (not rulesets) and no required reviews / enforce_admins: the queue pushes
 * `chore(queue): ...` commits straight to `main` and squash-merges PRs as soon as CI is green.
 * The gate is the required checks; `Perf (Reassure)` is informational and deliberately excluded.
 *
 * Environments (T5.2, #41): a GitHub Actions job that declares `environment: uat|production`
 * (release.yml, T5.3) waits for one of the reviewers below before it runs — that is the human
 * gate on anything that runs on GitHub. The EAS-side promotion (`.eas/workflows/promote.yml`)
 * is gated by its own `require-approval` job on expo.dev; environments do not apply to it.
 * Reviewers are given by login and resolved to ids with `gh api users/<login>` at apply time.
 *
 * Labels (T7.4, #55): `--apply` upserts every label in `DESIRED.labels` (POST when missing,
 * PATCH when the color or description differs) and never deletes labels it does not know about,
 * so GitHub's defaults and anything added by hand survive. `--check` reports missing labels and
 * color / description drift.
 *
 * Pages (T8.4, #143): `.github/workflows/docs.yml` deploys the VitePress site with
 * `actions/deploy-pages`, which needs the repo's Pages source set to "GitHub Actions"
 * (`build_type: workflow`). `--apply` POSTs the Pages site when there is none and PUTs
 * `build_type` when it is set to a branch; `--check` reports a missing site or a branch source.
 *
 * T2.7 (#26) owns `protection` + `repo`; T5.2 (#41) `environments`; T7.4 (#55) `labels`;
 * T8.4 (#143) `pages`.
 */
const { spawnSync } = require('node:child_process');

const BRANCH = 'main';

// Must match `name:` in .github/workflows/ci.yml and pr-title.yml (the matrix job expands to
// "Bundle budget (<platform>)").
const REQUIRED_CHECKS = [
  'Lint',
  'Typecheck',
  'Format',
  'Knip',
  'Env check',
  'i18n check',
  'Unit tests',
  'Commitlint',
  'Secret scan',
  'Bundle budget (web)',
  'Bundle budget (ios)',
  'Bundle budget (android)',
  'Maestro web',
  'Template init',
  'PR title',
];

// Every label the automation adds, filters on or opens issues with. Where each one is used:
//   epic:*            `/ship-next` (`gh pr create --label epic:<E>`), the queue ledger, PLAN.md epics
//   in-progress       `/ship-next` marks the ticket being worked
//   needs-human       `/ship-next` blockers that need a decision
//   deep-dive         deferred research tickets (PLAN.md E9)
//   flaky-flow, e2e   `.github/ISSUE_TEMPLATE/flaky-flow.yml` (docs/native-e2e.md → Flake budget)
//   e2e:ios           `.eas/workflows/e2e.yml` (`IOS_MODE=label` runs the iOS lane on labelled PRs)
//   e2e:cloud         `.eas/workflows/e2e-cloud.yml` (opt-in Maestro Cloud run; docs/native-e2e.md → Maestro Cloud)
//   fingerprint-drift `.github/workflows/ci.yml` (`Fingerprint drift` job; docs/release-ladder.md)
//   dependencies      `.github/renovate.json5` (`labels`)
// Colors are 6-hex without `#`, as the API expects.
const EPIC_COLOR = '1d76db';
const LABELS = [
  { name: 'epic:E0', color: EPIC_COLOR, description: 'Repo bootstrap and tooling baseline' },
  { name: 'epic:E1', color: EPIC_COLOR, description: 'Demo app and app-layer infra' },
  { name: 'epic:E2', color: EPIC_COLOR, description: 'JS gate (GitHub Actions)' },
  { name: 'epic:E3', color: EPIC_COLOR, description: 'EAS foundation' },
  { name: 'epic:E4', color: EPIC_COLOR, description: 'Native E2E lane (EAS Workflows)' },
  { name: 'epic:E5', color: EPIC_COLOR, description: 'Delivery ladder' },
  { name: 'epic:E6', color: EPIC_COLOR, description: 'Performance tooling' },
  { name: 'epic:E7', color: EPIC_COLOR, description: 'Template init script' },
  { name: 'epic:E8', color: EPIC_COLOR, description: 'Docs' },
  { name: 'epic:E9', color: EPIC_COLOR, description: 'Deferred deep-dive research tickets' },
  {
    name: 'in-progress',
    color: '0e8a16',
    description: 'Being worked on by /ship-next (one ticket at a time)',
  },
  {
    name: 'needs-human',
    color: 'fbca04',
    description: 'Blocked on a decision or action only a human can take',
  },
  {
    name: 'deep-dive',
    color: '5319e7',
    description: 'Research ticket: investigate and write up, no code expected',
  },
  {
    name: 'flaky-flow',
    color: 'fbca04',
    description: 'A Maestro flow that passes on retry; quarantine candidate (docs/native-e2e.md)',
  },
  { name: 'e2e', color: '0e8a16', description: 'Maestro E2E lanes (native + web)' },
  { name: 'e2e:ios', color: '5319e7', description: 'Run the iOS Maestro lane on this PR' },
  {
    name: 'e2e:cloud',
    color: '5319e7',
    description: 'Run the Maestro flows on Maestro Cloud for this PR (opt-in, paid)',
  },
  {
    name: 'fingerprint-drift',
    color: 'e99695',
    description:
      'PR changes the native fingerprint; merging needs a store release (docs/release-ladder.md)',
  },
  {
    name: 'dependencies',
    color: '0366d6',
    description: 'Renovate dependency update (.github/renovate.json5)',
  },
  // release-please's own labels (.github/workflows/release-please.yml): it puts `pending` on the
  // open release PR and swaps it for `tagged` once the merge is tagged.
  {
    name: 'autorelease: pending',
    color: 'ededed',
    description: 'Open release-please release PR; merging it cuts the version and tag',
  },
  {
    name: 'autorelease: tagged',
    color: 'ededed',
    description: 'Merged release PR whose commit release-please has tagged vX.Y.Z',
  },
];

/** Desired state. One object per section; `--only` picks a subset of `SECTIONS`. */
const DESIRED = {
  // PUT /repos/{owner}/{repo}/branches/main/protection
  protection: {
    required_status_checks: {
      strict: false,
      checks: REQUIRED_CHECKS.map((context) => ({ context })),
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
    required_conversation_resolution: false,
  },
  // PATCH /repos/{owner}/{repo}
  repo: {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
    delete_branch_on_merge: true,
    squash_merge_commit_title: 'PR_TITLE',
    squash_merge_commit_message: 'PR_BODY',
    // Renovate `platformAutomerge` uses GitHub's native auto-merge.
    allow_auto_merge: true,
  },
  // PUT /repos/{owner}/{repo}/environments/{name} — one entry per rung that a GitHub Actions job
  // may target with `environment:`. `reviewers` take `{ type: 'User' | 'Team', login }` here and
  // are resolved to `{ type, id }` for the API. `deployment_branch_policy` limits deployments to
  // protected branches (= `main`); tags are not protected branches, so a tag-triggered
  // release.yml job must deploy from `main` (checkout the tag inside the job) — T5.3 decides.
  // The init script rewrites the login to the GitHub repo owner. If that owner is an organization
  // (organizations cannot review), change it to a member's login or a `Team` (`org/team-slug`);
  // apply fails with that hint otherwise.
  environments: {
    uat: {
      wait_timer: 0,
      prevent_self_review: false,
      reviewers: [{ type: 'User', login: 'seandillon1224' }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    },
    production: {
      wait_timer: 0,
      prevent_self_review: false,
      reviewers: [{ type: 'User', login: 'seandillon1224' }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
    },
  },
  // POST /repos/{owner}/{repo}/labels (missing) or PATCH /repos/{owner}/{repo}/labels/{name}
  // (color / description differs). Keyed by name; unknown labels are left alone.
  labels: Object.fromEntries(
    LABELS.map(({ name, color, description }) => [name, { color, description }]),
  ),
  // POST /repos/{owner}/{repo}/pages (no site yet) or PUT /repos/{owner}/{repo}/pages (source is a
  // branch): the docs site is deployed by .github/workflows/docs.yml, so the source is Actions.
  pages: { build_type: 'workflow' },
};

const SECTIONS = Object.keys(DESIRED);

/** Recoverable failure: `main` prints the message and exits with `code` (2 = usage / env, 1 = drift). */
class RepoSettingsError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* gh plumbing — `ctx.gh(args, { input })` is the only side effect; tests inject a fake         */
/* ------------------------------------------------------------------------------------------ */

function defaultGh(args, { input } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input });
  if (result.error) {
    throw new RepoSettingsError(
      `repo:settings: failed to run gh (${result.error.message}); install https://cli.github.com`,
    );
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ghJson(ctx, args, opts) {
  const result = ctx.gh(args, opts);
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      body: safeJson(result.stdout),
      stderr: result.stderr,
    };
  }
  return { ok: true, status: 0, body: safeJson(result.stdout) };
}

function requireAuth(ctx) {
  const result = ctx.gh(['auth', 'status']);
  if (result.status !== 0) {
    throw new RepoSettingsError(
      `repo:settings: gh is not authenticated (${result.stderr.trim() || 'gh auth status failed'}); run \`gh auth login\` with an account that has admin on the repo`,
    );
  }
}

/** `owner/name` of the checkout's `origin` (or `GH_REPO`), via `gh repo view`. */
function repoSlug(ctx) {
  const result = ghJson(ctx, ['repo', 'view', '--json', 'nameWithOwner']);
  if (!result.ok || !result.body?.nameWithOwner) {
    throw new RepoSettingsError(
      `repo:settings: could not resolve the repo (${result.stderr?.trim() || 'gh repo view failed'}); run from a checkout whose \`origin\` is on GitHub, or set GH_REPO=owner/name`,
    );
  }
  return result.body.nameWithOwner;
}

/**
 * `{ type, login }` → `{ type, id }`: the environments API takes numeric ids only. A `User` login
 * that turns out to be an organization is rejected with a hint: organizations cannot review.
 */
function resolveReviewer(ctx, { type, login }) {
  const path =
    type === 'Team' ? `orgs/${login.split('/')[0]}/teams/${login.split('/')[1]}` : `users/${login}`;
  const result = ghJson(ctx, ['api', path]);
  if (!result.ok || typeof result.body?.id !== 'number') {
    throw new RepoSettingsError(
      `repo:settings: could not resolve reviewer ${type} "${login}" (${path})`,
    );
  }
  if (type === 'User' && result.body.type === 'Organization') {
    throw new RepoSettingsError(
      `repo:settings: reviewer "${login}" is an organization, and organizations cannot review deployments; set DESIRED.environments reviewers in scripts/repo-settings.js to a member login ({ type: 'User', login }) or a team ({ type: 'Team', login: '${login}/<team-slug>' })`,
    );
  }
  return { type, id: result.body.id };
}

function environmentBody(ctx, env) {
  return { ...env, reviewers: env.reviewers.map((r) => resolveReviewer(ctx, r)) };
}

/** Current labels, keyed by name → `{ color, description }` (paginated; the API caps at 100/page). */
function currentLabels(ctx, slug) {
  const result = ghJson(ctx, ['api', '--paginate', '--slurp', `repos/${slug}/labels?per_page=100`]);
  if (!result.ok) {
    throw new RepoSettingsError(`repo:settings: GET labels failed\n${result.stderr}`);
  }
  // `--slurp` wraps each page in an array; an old gh without it returns the pages concatenated.
  const pages = Array.isArray(result.body) ? result.body : [];
  const items = pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
  return Object.fromEntries(
    items.map(({ name, color, description }) => [
      name,
      { color: (color ?? '').toLowerCase(), description: description ?? '' },
    ]),
  );
}

function labelDrifted(want, got) {
  return got.color !== want.color.toLowerCase() || got.description !== want.description;
}

/** The repo's Pages site as `{ build_type }`, or `null` when Pages is not enabled. */
function currentPages(ctx, slug) {
  const result = ghJson(ctx, ['api', `repos/${slug}/pages`]);
  if (!result.ok) {
    if (result.body?.message === 'Not Found') return null;
    throw new RepoSettingsError(`repo:settings: GET pages failed\n${result.stderr}`);
  }
  return { build_type: result.body?.build_type ?? 'legacy' };
}

/**
 * The `gh api` calls that reconcile `only` sections, keyed for logging. Labels need a GET first
 * (upsert: POST when missing, PATCH when different, nothing when equal); the other sections are
 * idempotent PUT/PATCH of the full desired body.
 */
function endpoints(ctx, slug, only = SECTIONS) {
  const calls = {};
  if (only.includes('protection')) {
    calls.protection = {
      method: 'PUT',
      path: `repos/${slug}/branches/${BRANCH}/protection`,
      body: DESIRED.protection,
    };
  }
  if (only.includes('repo')) {
    calls.repo = { method: 'PATCH', path: `repos/${slug}`, body: DESIRED.repo };
  }
  if (only.includes('environments')) {
    for (const [name, env] of Object.entries(DESIRED.environments)) {
      calls[`environment:${name}`] = {
        method: 'PUT',
        path: `repos/${slug}/environments/${name}`,
        body: environmentBody(ctx, env),
      };
    }
  }
  if (only.includes('labels')) {
    const current = currentLabels(ctx, slug);
    for (const [name, want] of Object.entries(DESIRED.labels)) {
      const got = current[name];
      if (!got) {
        calls[`label:${name}`] = {
          method: 'POST',
          path: `repos/${slug}/labels`,
          body: { name, ...want },
        };
      } else if (labelDrifted(want, got)) {
        calls[`label:${name}`] = {
          method: 'PATCH',
          path: `repos/${slug}/labels/${encodeURIComponent(name)}`,
          body: { new_name: name, ...want },
        };
      }
    }
  }
  if (only.includes('pages')) {
    const current = currentPages(ctx, slug);
    if (current === null) {
      calls.pages = { method: 'POST', path: `repos/${slug}/pages`, body: DESIRED.pages };
    } else if (current.build_type !== DESIRED.pages.build_type) {
      calls.pages = { method: 'PUT', path: `repos/${slug}/pages`, body: DESIRED.pages };
    }
  }
  return calls;
}

/** Sections whose calls are upserts: nothing to write means "already up to date", not "skipped". */
function upToDate(only, calls) {
  const quiet = [];
  if (only.includes('labels') && !Object.keys(calls).some((k) => k.startsWith('label:'))) {
    quiet.push('labels');
  }
  if (only.includes('pages') && !calls.pages) quiet.push('pages');
  return quiet;
}

function apiArgs({ method, path }) {
  return [
    'api',
    '--method',
    method,
    '-H',
    'Accept: application/vnd.github+json',
    path,
    '--input',
    '-',
  ];
}

function dryRun(ctx, slug, only) {
  const calls = endpoints(ctx, slug, only);
  ctx.log(`repo:settings: dry run for ${slug} (no writes; sections: ${only.join(', ')})\n`);
  for (const call of Object.values(calls)) {
    ctx.log(`gh ${apiArgs(call).join(' ')} <<'JSON'`);
    ctx.log(JSON.stringify(call.body, null, 2));
    ctx.log('JSON\n');
  }
  for (const section of upToDate(only, calls)) {
    ctx.log(`${section}: already up to date, nothing to write\n`);
  }
}

function apply(ctx, slug, only) {
  const calls = endpoints(ctx, slug, only);
  for (const [name, call] of Object.entries(calls)) {
    const result = ghJson(ctx, apiArgs(call), { input: JSON.stringify(call.body) });
    if (!result.ok) {
      throw new RepoSettingsError(
        `repo:settings: ${call.method} ${call.path} failed\n${result.stderr}`,
        1,
      );
    }
    ctx.log(`repo:settings: applied ${name} (${call.method} ${call.path})`);
  }
  for (const section of upToDate(only, calls)) {
    ctx.log(`repo:settings: ${section} already up to date`);
  }
}

/* ------------------------------------------------------------------------------------------ */
/* --check: project the GET responses onto DESIRED's shape and compare field by field          */
/* ------------------------------------------------------------------------------------------ */

function currentProtection(ctx, slug) {
  const result = ghJson(ctx, ['api', `repos/${slug}/branches/${BRANCH}/protection`]);
  if (!result.ok) {
    if (result.body?.message === 'Branch not protected') return null;
    throw new RepoSettingsError(`repo:settings: GET branch protection failed\n${result.stderr}`);
  }
  const p = result.body;
  const enabled = (key) => Boolean(p[key]?.enabled);
  const checks = p.required_status_checks?.checks ?? [];
  return {
    required_status_checks: {
      strict: Boolean(p.required_status_checks?.strict),
      checks: checks.map(({ context }) => ({ context })),
    },
    enforce_admins: enabled('enforce_admins'),
    required_pull_request_reviews: p.required_pull_request_reviews ? '<set>' : null,
    restrictions: p.restrictions ? '<set>' : null,
    required_linear_history: enabled('required_linear_history'),
    allow_force_pushes: enabled('allow_force_pushes'),
    allow_deletions: enabled('allow_deletions'),
    required_conversation_resolution: enabled('required_conversation_resolution'),
  };
}

function currentRepo(ctx, slug) {
  const result = ghJson(ctx, ['api', `repos/${slug}`]);
  if (!result.ok) {
    throw new RepoSettingsError(`repo:settings: GET repo failed\n${result.stderr}`);
  }
  return Object.fromEntries(Object.keys(DESIRED.repo).map((key) => [key, result.body[key]]));
}

/** GET returns `protection_rules` (typed rules) + `deployment_branch_policy`; fold back to DESIRED's shape. */
function currentEnvironment(ctx, slug, name) {
  const result = ghJson(ctx, ['api', `repos/${slug}/environments/${name}`]);
  if (!result.ok) {
    if (result.body?.message === 'Not Found') return null;
    throw new RepoSettingsError(`repo:settings: GET environment ${name} failed\n${result.stderr}`);
  }
  const rules = result.body.protection_rules ?? [];
  const reviewersRule = rules.find((rule) => rule.type === 'required_reviewers');
  const waitRule = rules.find((rule) => rule.type === 'wait_timer');
  const policy = result.body.deployment_branch_policy;
  return {
    wait_timer: waitRule?.wait_timer ?? 0,
    prevent_self_review: Boolean(reviewersRule?.prevent_self_review),
    // Teams are written as `org/team-slug` in DESIRED; users as the bare login.
    reviewers: (reviewersRule?.reviewers ?? []).map(({ type, reviewer }) => ({
      type,
      login: type === 'Team' ? `${slug.split('/')[0]}/${reviewer.slug}` : reviewer.login,
    })),
    deployment_branch_policy: {
      protected_branches: Boolean(policy?.protected_branches),
      custom_branch_policies: Boolean(policy?.custom_branch_policies),
    },
  };
}

function diff(desired, actual, prefix = '') {
  const drift = [];
  for (const [key, want] of Object.entries(desired)) {
    const got = actual?.[key];
    const label = prefix + key;
    if (key === 'checks' || key === 'reviewers') {
      const id = (item) => (key === 'checks' ? item.context : `${item.type}:${item.login}`);
      const wantSet = want.map(id).sort();
      const gotSet = (got ?? []).map(id).sort();
      const missing = wantSet.filter((c) => !gotSet.includes(c));
      const extra = gotSet.filter((c) => !wantSet.includes(c));
      if (missing.length) drift.push(`${label}: missing ${JSON.stringify(missing)}`);
      if (extra.length) drift.push(`${label}: extra ${JSON.stringify(extra)}`);
    } else if (want !== null && typeof want === 'object') {
      drift.push(...diff(want, got, `${label}.`));
    } else if (got !== want) {
      drift.push(`${label}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return drift;
}

/** Drift lines for `only` sections (empty = in sync). Pure apart from the GETs through `ctx.gh`. */
function collectDrift(ctx, slug, only = SECTIONS) {
  const drift = [];
  if (only.includes('protection')) {
    const protection = currentProtection(ctx, slug);
    if (protection === null) {
      drift.push(`protection: branch "${BRANCH}" is not protected`);
    } else {
      drift.push(...diff(DESIRED.protection, protection, 'protection.'));
    }
  }
  if (only.includes('repo')) {
    drift.push(...diff(DESIRED.repo, currentRepo(ctx, slug), 'repo.'));
  }
  if (only.includes('environments')) {
    for (const [name, env] of Object.entries(DESIRED.environments)) {
      const current = currentEnvironment(ctx, slug, name);
      if (current === null) {
        drift.push(`environments.${name}: missing`);
      } else {
        drift.push(...diff(env, current, `environments.${name}.`));
      }
    }
  }
  if (only.includes('labels')) {
    const current = currentLabels(ctx, slug);
    for (const [name, want] of Object.entries(DESIRED.labels)) {
      const got = current[name];
      if (!got) {
        drift.push(`labels.${name}: missing`);
      } else {
        drift.push(
          ...diff(
            { color: want.color.toLowerCase(), description: want.description },
            got,
            `labels.${name}.`,
          ),
        );
      }
    }
  }
  if (only.includes('pages')) {
    const current = currentPages(ctx, slug);
    if (current === null) {
      drift.push('pages: not enabled (want build_type "workflow")');
    } else {
      drift.push(...diff(DESIRED.pages, current, 'pages.'));
    }
  }
  return drift;
}

function check(ctx, slug, only) {
  const drift = collectDrift(ctx, slug, only);
  if (drift.length) {
    throw new RepoSettingsError(
      [
        `repo:settings: ${slug} has drifted from scripts/repo-settings.js:`,
        ...drift.map((line) => `  - ${line}`),
        '',
        'Run `bun run repo:settings:apply` to reconcile.',
      ].join('\n'),
      1,
    );
  }
  ctx.log(`repo:settings: ${slug} matches desired state (sections: ${only.join(', ')})`);
}

/* ------------------------------------------------------------------------------------------ */
/* CLI                                                                                         */
/* ------------------------------------------------------------------------------------------ */

const MODES = { '--dry-run': dryRun, '--apply': apply, '--check': check };

/** `--dry-run | --apply | --check` (default dry run) plus `--only a,b` / `--only=a,b` (repeatable). */
function parseArgs(argv) {
  let mode = '--dry-run';
  let only = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (MODES[arg]) {
      mode = arg;
      continue;
    }
    if (arg === '--only' || arg.startsWith('--only=')) {
      const value = arg === '--only' ? argv[(i += 1)] : arg.slice('--only='.length);
      if (!value) throw new RepoSettingsError('repo:settings: --only needs a value');
      const names = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = names.filter((s) => !SECTIONS.includes(s));
      if (unknown.length) {
        throw new RepoSettingsError(
          `repo:settings: unknown section ${unknown.join(', ')} in --only; expected a comma-separated subset of ${SECTIONS.join(', ')}`,
        );
      }
      only = [...(only ?? []), ...names];
      continue;
    }
    throw new RepoSettingsError(
      `repo:settings: unknown flag ${arg}; expected one of ${Object.keys(MODES).join(', ')} and optionally --only <${SECTIONS.join('|')}>`,
    );
  }
  // Keep DESIRED's order regardless of how --only was spelled.
  return { mode, only: only ? SECTIONS.filter((s) => only.includes(s)) : SECTIONS };
}

function main(argv, ctx = { gh: defaultGh, log: (line) => console.log(line) }) {
  try {
    const { mode, only } = parseArgs(argv);
    requireAuth(ctx);
    MODES[mode](ctx, repoSlug(ctx), only);
    return 0;
  } catch (error) {
    if (error instanceof RepoSettingsError) {
      console.error(error.message);
      return error.code;
    }
    throw error;
  }
}

module.exports = {
  DESIRED,
  LABELS,
  REQUIRED_CHECKS,
  RepoSettingsError,
  SECTIONS,
  apiArgs,
  collectDrift,
  endpoints,
  main,
  parseArgs,
  repoSlug,
  requireAuth,
  resolveReviewer,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
