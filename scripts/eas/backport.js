#!/usr/bin/env node
/**
 * `backport` job of .eas/workflows/backport.yml (T11.3, ADR-0008): publish an OTA-safe fix from
 * `main` to the runtime of one or more OLDER store releases.
 *
 *   node scripts/eas/backport.js --tags v1.2.0,v1.1.0 --fix <sha> --plan "<plan>" \
 *     --subject "<fix subject>" [--ref backport/v1.2.0] [--rollout 100] [--platforms both]
 *     [--message "..."] [--timeout 1800]
 *
 * EAS has no matrix, so this is one job looping over the tags: every tag is attempted, a per-tag
 * summary is printed, and the process fails at the END if any tag failed — one bad tag never
 * blocks the others. Per tag: the tag's tree (+ the cherry-pick, or a prepared `--ref`) →
 * `bun install` → the fingerprint of that tree must equal the CLEAN tag's fingerprint from
 * `--plan` AND that fingerprint must have a production store build → `eas update` for the passing
 * platforms only. A mismatch means the fix is not OTA-safe for that release; it is refused, never
 * published.
 *
 * `--plan` is the `resolve` job's output, `<tag>/<platform>=<fingerprint>:<build id|none>;` repeated.
 *
 * `--timeout` is a per-TAG budget (seconds): every child process gets what is left of it, and a tag
 * that runs out is failed as `FAIL (timeout)` so a wedged `git`, `bun install` or `eas update`
 * cannot burn the whole job's worker time and take the remaining tags down with it.
 *
 * NOTE: this script checks out other commits, which REPLACES `scripts/` under its own feet. Every
 * `require` is therefore at the top, before the first checkout — a lazy one would load the tag's
 * copy of the module. Same reason the per-tag work shells out to `bun run …` (the TAG's scripts and
 * its pinned eas-cli, which is the point) rather than importing anything.
 *
 * Exit codes follow scripts/lib/args.js (0 every tag published, 1 at least one failed, 2 usage).
 * Plain Node built-ins only.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const { ScriptError, parseArgs: parseCli, runMain } = require('../lib/args');
const { easBin } = require('../lib/bin');

/** Rewritten by `bun run init` (scripts/init.js → the rewrite manifest). */
const PROJECT_URL = 'https://expo.dev/accounts/seandillon1224/projects/expo-boilerplate';

const CLI = {
  name: 'backport',
  usage: `Usage: node scripts/eas/backport.js --tags v1.2.0,v1.1.0 --fix <sha> --plan <plan> --subject <subject>

Cherry-picks a fix onto each store release tag, gates it on the fingerprint, and publishes an OTA
update to \`production\` for the platforms that pass.

Options:
  --tags <a,b>        comma-separated store release tags (required)
  --fix <sha>         commit on origin/main to cherry-pick; omit only with --ref
  --ref <branch>      prepared branch that already contains the fix (exactly one tag, no cherry-pick)
  --plan <plan>       resolve job output: <tag>/<platform>=<fingerprint>:<build|none>; repeated
  --subject <text>    the fix's subject, for the update message and the summary
  --message <text>    optional update-message suffix, used instead of --subject
  --rollout <n>       share of production installs on that runtime, 1-100 (default: 100)
  --platforms <p>     both | ios | android (default: both)
  --timeout <n>       per-tag budget in seconds (default: 1800)`,
  options: {
    tags: { type: 'string', required: true },
    fix: { type: 'string', default: '' },
    ref: { type: 'string', default: '' },
    plan: { type: 'string', default: '' },
    subject: { type: 'string', default: '' },
    message: { type: 'string', default: '' },
    rollout: { type: 'number', integer: true, min: 1, default: 100 },
    platforms: { type: 'string', choices: ['both', 'ios', 'android'], default: 'both' },
    timeout: { type: 'number', integer: true, min: 1, default: 1800 },
  },
};

/** A tag that ran out of its `--timeout` budget: failed on its own, the loop carries on. */
class TagTimeout extends Error {}

/**
 * One child process against the current tag's remaining budget.
 * `capture` pipes stdout back (and trims it); otherwise stdout goes to the job log.
 */
function sh(file, args, { deadline, capture = false } = {}) {
  const timeout = Math.max(1, deadline - Date.now());
  const result = spawnSync(file, args, {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM') {
    throw new TagTimeout(`\`${file} ${args.join(' ')}\` ran out of the per-tag time budget`);
  }
  if (result.error) throw new TagTimeout(`\`${file}\` could not be run: ${result.error.message}`);
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

/**
 * The clean tag's fingerprint and the store build that runs it, out of the resolve job's plan.
 * `expected` is everything up to the FIRST colon and `build` everything after the LAST one, as the
 * shell version was — neither a fingerprint nor a build id contains a colon.
 */
function planEntry(plan, tag, platform) {
  const prefix = `${tag}/${platform}=`;
  const entry = plan
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!entry) return { expected: '', build: '' };
  const value = entry.slice(prefix.length);
  const first = value.indexOf(':');
  const last = value.lastIndexOf(':');
  return {
    expected: first === -1 ? value : value.slice(0, first),
    build: last === -1 ? value : value.slice(last + 1),
  };
}

const platformsOf = (selection) =>
  ['ios', 'android'].filter((p) => selection === 'both' || selection === p);

/** `eas update --json` output → the published group id. */
function groupOf(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return (Array.isArray(parsed) ? parsed[0] : parsed)?.group ?? '';
  } catch {
    return '';
  }
}

/**
 * Checks out the backport tree for one tag. Returns the short fix id used in the update message,
 * or `null` after printing why this tag cannot be prepared.
 */
function prepare(tag, { fix, ref, rollout, deadline }) {
  const git = (...args) => sh('git', args, { deadline });
  git('fetch', '-q', 'origin', `refs/tags/${tag}:refs/tags/${tag}`);

  if (ref) {
    // The resolve job already proved the branch is on origin; a failure here is a race, not a typo.
    const fetched = git('fetch', '-q', 'origin', ref);
    if (fetched.ok) git('checkout', '-q', '--detach', 'FETCH_HEAD');
    if (!fetched.ok || !git('merge-base', '--is-ancestor', tag, 'HEAD').ok) {
      console.log(
        `${tag}: FAIL — ${ref} does not contain tag ${tag}; branch from the tag: git checkout -b ${ref} ${tag}`,
      );
      return null;
    }
    return ref;
  }

  git('fetch', '-q', 'origin', 'main');
  git('checkout', '-q', '--detach', tag);
  const short = sh('git', ['rev-parse', '--short', fix], { deadline, capture: true }).stdout;
  if (git('cherry-pick', '-x', fix).ok) return short;

  git('cherry-pick', '--abort');
  console.log(
    [
      `${tag}: FAIL — cherry-pick of ${fix} conflicts. Resolve it locally and re-run with a prepared branch:`,
      `  git fetch origin --tags && git checkout -b backport/${tag} ${tag}`,
      `  git cherry-pick -x ${fix}      # resolve, keep the change OTA-safe (JS/assets only)`,
      '  bun run fingerprint --platform ios && bun run fingerprint --platform android   # must equal the tag’s',
      `  git push -u origin backport/${tag}`,
      `  bun run eas workflow:run .eas/workflows/backport.yml -F tags=${tag} -F ref=backport/${tag} -F rollout_percentage=${rollout}`,
    ].join('\n'),
  );
  return null;
}

/** The fingerprint gate for one prepared tag: the platforms that may be published. */
function gate(tag, { plan, platforms, deadline }) {
  const passing = [];
  for (const platform of platformsOf(platforms)) {
    const { expected, build } = planEntry(plan, tag, platform);
    const fingerprint = sh('bun', ['run', '--silent', 'fingerprint', '--platform', platform], {
      deadline,
      capture: true,
    }).stdout;
    if (build === 'none' || !expected) {
      console.log(
        `${tag}/${platform}: REFUSED — no production store build runs fingerprint ${expected || '?'}; nothing to backport to (bun run eas build:list -p ${platform} -e production --distribution store)`,
      );
    } else if (fingerprint !== expected) {
      console.log(
        `${tag}/${platform}: REFUSED — fingerprint ${fingerprint} != ${expected}: this fix is not OTA-safe for ${tag} on ${platform}; it needs a fix release (docs/release-ladder.md → Store release)`,
      );
    } else {
      console.log(`${tag}/${platform}: OK — fingerprint ${fingerprint} == store build ${build}`);
      passing.push(platform);
    }
  }
  return passing;
}

/** `eas update --channel production` for the passing platforms. Returns the summary line, or null. */
function publish(tag, passing, { rollout, message, subject, fixId, deadline }) {
  const platform = passing.length === 2 ? 'all' : passing[0];
  const rolloutArgs = rollout < 100 ? ['--rollout-percentage', String(rollout)] : [];
  const args = [
    'update',
    '--channel',
    'production',
    '--environment',
    'production',
    '-p',
    platform,
    ...rolloutArgs,
    '-m',
    `backport ${fixId} onto ${tag}: ${message || subject}`,
    '--json',
    '--non-interactive',
  ];
  const published = sh(easBin, args, { deadline, capture: true });
  fs.writeFileSync(`update-${tag}.json`, published.stdout);
  if (!published.ok) {
    console.log(`${tag}: FAIL — eas update failed`);
    return null;
  }
  const group = groupOf(published.stdout);
  console.log(
    `${tag}: PUBLISHED group ${group} (${platform}, ${rollout}%) ${PROJECT_URL}/updates/${group} — ramp: bun run eas update:edit ${group} --rollout-percentage <n>`,
  );
  // Source maps, best-effort as in deploy-staging.yml (skips without SENTRY_* on production).
  if (!sh('bun', ['run', 'sentry:sourcemaps'], { deadline }).ok) {
    console.log(`${tag}: sentry:sourcemaps skipped/failed — best-effort`);
  }
  return `${tag}: published ${group} (${platform}, ${rollout}%)`;
}

function main(argv) {
  const { values, help } = parseCli(argv, CLI);
  if (help) return 0;
  if (values.rollout > 100)
    throw new ScriptError(`--rollout must be 1-100 (got ${values.rollout}).`);

  const tags = values.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (tags.length === 0) throw new ScriptError('--tags is empty.');
  if (values.ref && tags.length !== 1) {
    throw new ScriptError(`--ref ${values.ref} needs exactly one tag, got ${tags.length}.`);
  }
  if (!values.ref && !values.fix) throw new ScriptError('--fix is required unless --ref is set.');

  sh('git', ['config', 'user.name', 'backport'], { deadline: Date.now() + 30_000 });
  sh('git', ['config', 'user.email', 'backport@eas'], { deadline: Date.now() + 30_000 });

  const failed = [];
  const summary = [];
  for (const tag of tags) {
    console.log(`=================== ${tag}`);
    const deadline = Date.now() + values.timeout * 1000;
    try {
      const fixId = prepare(tag, {
        fix: values.fix,
        ref: values.ref,
        rollout: values.rollout,
        deadline,
      });
      if (fixId === null) {
        failed.push(tag);
        summary.push(`${tag}: FAIL (${values.ref ? 'ref' : 'conflict'})`);
        continue;
      }
      if (!sh('bun', ['install', '--frozen-lockfile', '--silent'], { deadline }).ok) {
        console.log(`${tag}: FAIL — bun install failed on the backport tree (lockfile drift?)`);
        failed.push(tag);
        summary.push(`${tag}: FAIL (install)`);
        continue;
      }
      const passing = gate(tag, { plan: values.plan, platforms: values.platforms, deadline });
      if (passing.length === 0) {
        failed.push(tag);
        summary.push(`${tag}: REFUSED`);
        continue;
      }
      const line = publish(tag, passing, {
        rollout: values.rollout,
        message: values.message,
        subject: values.subject,
        fixId,
        deadline,
      });
      if (line === null) {
        failed.push(tag);
        summary.push(`${tag}: FAIL (publish)`);
        continue;
      }
      summary.push(line);
    } catch (error) {
      if (!(error instanceof TagTimeout)) throw error;
      console.log(`${tag}: FAIL — ${error.message} (--timeout ${values.timeout}s)`);
      failed.push(tag);
      summary.push(`${tag}: FAIL (timeout)`);
    }
  }

  console.log(['', `=== Backport summary (fix: ${values.subject})`, ...summary, ''].join('\n'));
  if (failed.length > 0) {
    throw new ScriptError(
      `Backport failed for: ${failed.join(' ')} — see above; the other tags were still published.`,
    );
  }
  return 0;
}

module.exports = { CLI, groupOf, planEntry, platformsOf };

if (require.main === module) runMain(main);
