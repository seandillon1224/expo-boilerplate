#!/usr/bin/env node
/**
 * The Slack post of every EAS workflow that has one (T11.3): deploy-staging, promote, release,
 * rollout.
 *
 *   node scripts/eas/slack-compose.js staging|promote|release|rollout   # message → stdout
 *
 * Each workflow's `slack` job now declares its facts once as a job `env:` block — the values are
 * all `after.<job>.status` / `after.<job>.outputs.*` expressions, never `needs.*`, because the
 * Slack job depends via `after:` so the post goes out on a red run too (docs/ci-overview.md) — and
 * this file turns them into Slack mrkdwn. Before, every workflow carried the same nested-ternary
 * heredoc and its own copy of the expo.dev project URL.
 *
 * A missing job leaves its variables empty (`''`): a skipped job has no outputs, and EAS resolves
 * both branches of a ternary, which is why the shell version guarded every value with `|| ''`.
 * Reading `process.env` gives that for free.
 *
 * The composer functions are pure `(env) => string`, so the wording is unit-testable; nothing here
 * talks to Slack. The workflow pipes the output into `set-output text` and hands that to the
 * `eas/send_slack_message` step, which is skipped while `SLACK_WEBHOOK_URL` is unset.
 *
 * Exit codes follow scripts/lib/args.js (0 ok, 2 usage). Plain Node built-ins only.
 */
const { UsageError, parseArgs: parseCli, runMain } = require('../lib/args');

/** Rewritten by `bun run init` (scripts/init.js → the rewrite manifest). */
const PROJECT_URL = 'https://expo.dev/accounts/seandillon1224/projects/expo-boilerplate';

const buildUrl = (id) => `${PROJECT_URL}/builds/${id}`;
const updateUrl = (id) => `${PROJECT_URL}/updates/${id}`;
/** `substring(x || '', 0, n)` in EAS expression form. */
const short = (value, length) => String(value ?? '').slice(0, length);
const run = (env) => `<${env.WORKFLOW_URL}|workflow run>`;

/** deploy-staging.yml — every push to main. */
function staging(env) {
  const built = env.BUILD_IOS_STATUS === 'success' || env.BUILD_ANDROID_STATUS === 'success';
  const status =
    env.UPDATE_STATUS === 'success'
      ? '✅ published'
      : env.UPDATE_STATUS === 'failure'
        ? '❌ update failed'
        : '⏭️ update skipped';
  const critical = env.CRITICAL === 'yes' ? ' · 🚨 *critical* (forced reload)' : '';
  const ios = env.BUILD_IOS_ID
    ? `<${buildUrl(env.BUILD_IOS_ID)}|new build — install page + QR>`
    : env.GET_BUILD_IOS_ID
      ? `<${buildUrl(env.GET_BUILD_IOS_ID)}|current build — install page + QR>`
      : env.BUILD_IOS_STATUS === 'failure'
        ? '❌ build failed (credentials? docs/environments-and-secrets.md → iOS runbook)'
        : '⏭️ no build for this fingerprint (IOS_BUILDS disabled)';
  const android = env.BUILD_ANDROID_ID
    ? `<${buildUrl(env.BUILD_ANDROID_ID)}|new build — install page + QR>`
    : env.GET_BUILD_ANDROID_ID
      ? `<${buildUrl(env.GET_BUILD_ANDROID_ID)}|current build — install page + QR>`
      : `❌ build failed (${env.BUILD_ANDROID_STATUS})`;
  const update = env.UPDATE_GROUP_ID
    ? `<${updateUrl(env.UPDATE_GROUP_ID)}|${short(env.UPDATE_GROUP_ID, 8)}> · \`bun run eas update:view ${env.UPDATE_GROUP_ID}\``
    : 'none';
  const web = env.DEPLOY_URL
    ? `<${env.DEPLOY_URL}|${env.DEPLOY_URL}>`
    : env.DEPLOY_WEB_STATUS === 'failure'
      ? '❌ deploy failed'
      : '⏭️ skipped (HOSTING disabled)';
  return [
    `*Staging* · ${status}${critical} · \`${short(env.SHA, 7)}\` ${env.COMMIT_MESSAGE ? `— ${short(env.COMMIT_MESSAGE, 120)}` : '(manual run)'}`,
    built
      ? ':warning: *Reinstall required* — the native fingerprint changed, new staging builds were cut. Installed apps will NOT receive this update.'
      : 'JS-only change: installed staging apps pick it up on next launch.',
    `• *iOS*: ${ios}`,
    `• *Android*: ${android}`,
    `• *Update*: ${update}`,
    `• *Web*: ${web}`,
    `• *Fingerprint*: ios \`${short(env.IOS_FP, 12)}\` · android \`${short(env.ANDROID_FP, 12)}\` · ${run(env)}`,
  ].join('\n');
}

/** promote.yml — the manual uat / production rung. */
function promote(env) {
  const target = env.TARGET;
  const built = env.BUILD_IOS_STATUS === 'success' || env.BUILD_ANDROID_STATUS === 'success';
  const status =
    env.REPUBLISH_STATUS === 'success'
      ? '✅ promoted'
      : env.APPROVE_STATUS === 'failure'
        ? '🚫 rejected'
        : env.GATE_STATUS === 'failure'
          ? '⛔ gate refused'
          : env.REPUBLISH_STATUS === 'failure'
            ? '❌ republish failed'
            : '⏭️ nothing published';
  const ios = env.BUILD_IOS_ID
    ? `<${buildUrl(env.BUILD_IOS_ID)}|new uat build>`
    : env.BUILD_IOS_STATUS === 'failure'
      ? '❌ build failed (credentials?)'
      : env.GATE_BUILD_IOS === 'true'
        ? '⏭️ IOS_BUILDS disabled'
        : 'existing build';
  const android = env.BUILD_ANDROID_ID
    ? `<${buildUrl(env.BUILD_ANDROID_ID)}|new uat build>`
    : env.BUILD_ANDROID_STATUS === 'failure'
      ? '❌ build failed'
      : 'existing build';
  const webUrl = env.WEB_UAT_URL || env.WEB_PROD_URL;
  const web = webUrl
    ? `<${webUrl}>`
    : env.WEB_UAT_STATUS === 'failure' || env.WEB_PROD_STATUS === 'failure'
      ? '❌ deploy failed'
      : '⏭️ skipped';
  return [
    `*Promote → ${target}* · ${status} · group \`${short(env.GROUP_ID, 8)}\` ${env.GROUP_MESSAGE ? `— ${env.GROUP_MESSAGE}` : ''}`,
    built
      ? ':warning: *Reinstall required* — new uat builds cut; installed uat apps will not get this update.'
      : env.REPUBLISH_STATUS === 'success'
        ? `Installed ${target} apps pick it up on next launch.`
        : 'See the run log.',
    `• *Update*: ${env.REPUBLISH_GROUP_ID ? `<${updateUrl(env.REPUBLISH_GROUP_ID)}|${short(env.REPUBLISH_GROUP_ID, 8)}> on \`${target}\`` : 'none'} · ${run(env)}`,
    `• *iOS*: ${ios}`,
    `• *Android*: ${android}`,
    `• *Web*: ${web}`,
  ].join('\n');
}

/** release.yml — the store rung, triggered by a `vX.Y.Z` tag. */
function release(env) {
  const status =
    env.VERSION_CHECK_STATUS === 'failure'
      ? '❌ tag does not match app version'
      : env.GATE_STATUS !== 'success'
        ? '❌ fingerprint / gate failed'
        : env.BUILD_IOS_STATUS === 'failure' || env.BUILD_ANDROID_STATUS === 'failure'
          ? '❌ build failed'
          : env.TESTFLIGHT_STATUS === 'failure' || env.SUBMIT_STATUS === 'failure'
            ? '❌ submit failed'
            : env.BUILD_IOS_STATUS === 'success' || env.BUILD_ANDROID_STATUS === 'success'
              ? '✅ store builds cut'
              : '⏭️ skipped — fingerprint unchanged since last store build (force=yes to override)';
  const testflight =
    env.TESTFLIGHT_STATUS === 'success'
      ? 'uploaded → TestFlight group `Internal`'
      : env.TESTFLIGHT_STATUS === 'failure'
        ? '❌ TestFlight failed (ASC API key / ascAppId / `Internal` group?)'
        : 'TestFlight skipped';
  const ios = env.BUILD_IOS_ID
    ? `<${buildUrl(env.BUILD_IOS_ID)}|build> · ${testflight}`
    : env.BUILD_IOS_STATUS === 'failure'
      ? '❌ build failed (credentials?)'
      : env.GATE_RELEASE_IOS === 'true'
        ? '⏭️ IOS_RELEASE disabled'
        : '⏭️ nothing to release';
  const submit =
    env.SUBMIT_STATUS === 'success'
      ? 'submitted → Play internal track'
      : env.SUBMIT_STATUS === 'failure'
        ? '❌ submit failed (service account?)'
        : '⏭️ submit skipped (PLAY_SUBMIT disabled) — upload the AAB by hand';
  const android = env.BUILD_ANDROID_ID
    ? `<${buildUrl(env.BUILD_ANDROID_ID)}|build> · ${submit}`
    : env.BUILD_ANDROID_STATUS === 'failure'
      ? '❌ build failed'
      : '⏭️ nothing to release';
  return [
    `*Release ${env.TAG}* · ${status}`,
    `• *iOS*: ${ios}`,
    `• *Android*: ${android}`,
    `• *Fingerprint*: ios \`${short(env.IOS_FP, 12)}\` · android \`${short(env.ANDROID_FP, 12)}\` · ${run(env)}`,
  ].join('\n');
}

/** rollout.yml — the manual ramp of a production rollout group. */
function rollout(env) {
  // One `update-rollout` job per choice; exactly one of the four ran (see rollout.yml's header).
  const ramped = (env.RAMP_STATUSES || '').split(/\s+/).includes('success');
  const status = ramped
    ? '✅ ramped'
    : env.APPROVE_STATUS === 'failure'
      ? '🚫 rejected'
      : env.RESOLVE_STATUS === 'failure'
        ? '❌ refused (see the run log)'
        : '❌ ramp failed';
  return [
    `*Rollout → ${env.TARGET_PCT}%* · ${status} · group \`${short(env.GROUP_ID, 8)}\` ${env.GROUP_MESSAGE ? `— ${env.GROUP_MESSAGE}` : ''}`,
    `• *Update*: <${updateUrl(env.GROUP_ID)}|${short(env.GROUP_ID, 8)}> on \`production\` · was ${env.ROLLOUT_WAS || '?'}% · ${run(env)}`,
    `• ${
      env.TARGET_PCT === '100'
        ? 'Rollout complete: every production install picks it up on next launch.'
        : `Watch it: \`bun run eas update:view ${env.GROUP_ID} --insights --days 1\``
    }`,
  ].join('\n');
}

const COMPOSERS = { staging, promote, release, rollout };

const CLI = {
  name: 'slack-compose',
  usage: `Usage: node scripts/eas/slack-compose.js <${Object.keys(COMPOSERS).join('|')}>

Prints the Slack message for that workflow's \`slack\` job, built from the job's env block.`,
  allowPositionals: true,
};

function main(argv) {
  const { positionals, help } = parseCli(argv, CLI);
  if (help) return 0;
  const workflow = positionals[0];
  const compose = Object.hasOwn(COMPOSERS, workflow ?? '') ? COMPOSERS[workflow] : undefined;
  if (!compose) {
    throw new UsageError(
      `slack-compose: expected one workflow (${Object.keys(COMPOSERS).join('|')}), got \`${workflow ?? ''}\`. Try --help.`,
    );
  }
  console.log(compose(process.env));
  return 0;
}

module.exports = { COMPOSERS, promote, release, rollout, staging };

if (require.main === module) runMain(main);
