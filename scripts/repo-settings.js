#!/usr/bin/env node
/**
 * GitHub repo settings as code: `main` branch protection (required checks), the merge settings
 * Renovate `platformAutomerge` needs, and the `uat` / `production` deployment environments with
 * required reviewers. Plain Node/JS, shells out to `gh api`.
 *
 * Usage (needs `gh auth login` with admin on the repo):
 *   bun run repo:settings          # --dry-run (default): print the gh api calls + payloads, no writes
 *   bun run repo:settings:apply    # --apply: PUT branch protection + PATCH repo + PUT environments
 *   bun run repo:settings:check    # --check: GET current state, diff against DESIRED, exit 1 on drift
 *
 * Run `:apply` once after creating a repo from this template, and again whenever DESIRED changes.
 * There is no CI drift guard: the Actions `GITHUB_TOKEN` cannot read branch protection.
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
 * T2.7 (#26) owns `protection` + `repo`; T5.2 (#41) `environments`. #55 adds labels.
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
  'PR title',
];

/** Desired state. One object so later tickets can add sections (environments, labels, ...). */
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
};

module.exports = { DESIRED, REQUIRED_CHECKS };

function gh(args, { input } = {}) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input });
  if (result.error) {
    console.error(
      `repo:settings: failed to run gh (${result.error.message}); install https://cli.github.com`,
    );
    process.exit(2);
  }
  return result;
}

function ghJson(args, opts) {
  const result = gh(args, opts);
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

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function repoSlug() {
  const result = ghJson(['repo', 'view', '--json', 'nameWithOwner']);
  if (!result.ok || !result.body?.nameWithOwner) {
    console.error(
      `repo:settings: could not resolve repo (${result.stderr?.trim() || 'gh repo view failed'})`,
    );
    process.exit(2);
  }
  return result.body.nameWithOwner;
}

/** `{ type, login }` → `{ type, id }`: the environments API takes numeric ids only. */
function resolveReviewer({ type, login }) {
  const path =
    type === 'Team' ? `orgs/${login.split('/')[0]}/teams/${login.split('/')[1]}` : `users/${login}`;
  const result = ghJson(['api', path]);
  if (!result.ok || typeof result.body?.id !== 'number') {
    console.error(`repo:settings: could not resolve reviewer ${type} "${login}" (${path})`);
    process.exit(2);
  }
  return { type, id: result.body.id };
}

function environmentBody(env) {
  return { ...env, reviewers: env.reviewers.map(resolveReviewer) };
}

function endpoints(slug) {
  const calls = {
    protection: {
      method: 'PUT',
      path: `repos/${slug}/branches/${BRANCH}/protection`,
      body: DESIRED.protection,
    },
    repo: { method: 'PATCH', path: `repos/${slug}`, body: DESIRED.repo },
  };
  for (const [name, env] of Object.entries(DESIRED.environments)) {
    calls[`environment:${name}`] = {
      method: 'PUT',
      path: `repos/${slug}/environments/${name}`,
      body: environmentBody(env),
    };
  }
  return calls;
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

function dryRun(slug) {
  console.log(`repo:settings: dry run for ${slug} (no writes)\n`);
  for (const call of Object.values(endpoints(slug))) {
    console.log(`gh ${apiArgs(call).join(' ')} <<'JSON'`);
    console.log(JSON.stringify(call.body, null, 2));
    console.log('JSON\n');
  }
}

function apply(slug) {
  for (const [name, call] of Object.entries(endpoints(slug))) {
    const result = ghJson(apiArgs(call), { input: JSON.stringify(call.body) });
    if (!result.ok) {
      console.error(`repo:settings: ${call.method} ${call.path} failed\n${result.stderr}`);
      process.exit(1);
    }
    console.log(`repo:settings: applied ${name} (${call.method} ${call.path})`);
  }
}

/** Project the GET responses onto DESIRED's shape so they can be compared field by field. */
function currentProtection(slug) {
  const result = ghJson(['api', `repos/${slug}/branches/${BRANCH}/protection`]);
  if (!result.ok) {
    if (result.body?.message === 'Branch not protected') return null;
    console.error(`repo:settings: GET branch protection failed\n${result.stderr}`);
    process.exit(2);
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

function currentRepo(slug) {
  const result = ghJson(['api', `repos/${slug}`]);
  if (!result.ok) {
    console.error(`repo:settings: GET repo failed\n${result.stderr}`);
    process.exit(2);
  }
  return Object.fromEntries(Object.keys(DESIRED.repo).map((key) => [key, result.body[key]]));
}

/** GET returns `protection_rules` (typed rules) + `deployment_branch_policy`; fold back to DESIRED's shape. */
function currentEnvironment(slug, name) {
  const result = ghJson(['api', `repos/${slug}/environments/${name}`]);
  if (!result.ok) {
    if (result.body?.message === 'Not Found') return null;
    console.error(`repo:settings: GET environment ${name} failed\n${result.stderr}`);
    process.exit(2);
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

function check(slug) {
  const drift = [];
  const protection = currentProtection(slug);
  if (protection === null) {
    drift.push(`protection: branch "${BRANCH}" is not protected`);
  } else {
    drift.push(...diff(DESIRED.protection, protection, 'protection.'));
  }
  drift.push(...diff(DESIRED.repo, currentRepo(slug), 'repo.'));
  for (const [name, env] of Object.entries(DESIRED.environments)) {
    const current = currentEnvironment(slug, name);
    if (current === null) {
      drift.push(`environments.${name}: missing`);
    } else {
      drift.push(...diff(env, current, `environments.${name}.`));
    }
  }

  if (drift.length) {
    console.error(`repo:settings: ${slug} has drifted from scripts/repo-settings.js:`);
    for (const line of drift) console.error(`  - ${line}`);
    console.error('\nRun `bun run repo:settings:apply` to reconcile.');
    process.exit(1);
  }
  console.log(`repo:settings: ${slug} matches desired state`);
}

if (require.main === module) {
  const modes = { '--dry-run': dryRun, '--apply': apply, '--check': check };
  const flag = process.argv[2] ?? '--dry-run';
  const run = modes[flag];
  if (!run) {
    console.error(
      `repo:settings: unknown flag ${flag}; expected one of ${Object.keys(modes).join(', ')}`,
    );
    process.exit(2);
  }
  run(repoSlug());
}
