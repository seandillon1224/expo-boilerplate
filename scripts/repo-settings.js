#!/usr/bin/env node
/**
 * GitHub repo settings as code: `main` branch protection (required checks) and the merge
 * settings Renovate `platformAutomerge` needs. Plain Node/JS, shells out to `gh api`.
 *
 * Usage (needs `gh auth login` with admin on the repo):
 *   bun run repo:settings          # --dry-run (default): print the gh api calls + payloads, no writes
 *   bun run repo:settings:apply    # --apply: PUT branch protection + PATCH repo settings
 *   bun run repo:settings:check    # --check: GET current state, diff against DESIRED, exit 1 on drift
 *
 * Run `:apply` once after creating a repo from this template, and again whenever DESIRED changes.
 * There is no CI drift guard: the Actions `GITHUB_TOKEN` cannot read branch protection.
 *
 * Why classic protection (not rulesets) and no required reviews / enforce_admins: the queue pushes
 * `chore(queue): ...` commits straight to `main` and squash-merges PRs as soon as CI is green.
 * The gate is the required checks; `Perf (Reassure)` is informational and deliberately excluded.
 *
 * T2.7 (#26) owns `protection` + `repo`. #55 extends DESIRED with environments / labels.
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

function endpoints(slug) {
  return {
    protection: {
      method: 'PUT',
      path: `repos/${slug}/branches/${BRANCH}/protection`,
      body: DESIRED.protection,
    },
    repo: { method: 'PATCH', path: `repos/${slug}`, body: DESIRED.repo },
  };
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

function diff(desired, actual, prefix = '') {
  const drift = [];
  for (const [key, want] of Object.entries(desired)) {
    const got = actual?.[key];
    const label = prefix + key;
    if (key === 'checks') {
      const wantSet = want.map((c) => c.context).sort();
      const gotSet = (got ?? []).map((c) => c.context).sort();
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
