/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node scripts under test; no @types/node */
/**
 * The pure halves of the scripts that .eas/workflows/*.yml run (T11.3).
 *
 * These workflows gate real releases and none of them can be run locally, so the parts that DECIDE
 * something — which group is promoted, whether a build has to be cut, which tag/platform is
 * OTA-safe, what the Slack post says — are functions over injected data and are pinned here. What
 * stays unexercised is the plumbing around them: the eas-cli calls, the git/bun child processes and
 * `set-output`.
 */
const { gate } = require('../eas/fingerprint-gate');
const promoteResolve = require('../eas/promote-resolve');
const rolloutResolve = require('../eas/rollout-resolve');
const backport = require('../eas/backport');
const slack = require('../eas/slack-compose');

type Run = (args: string[]) => unknown;

/** An `easJson` stand-in: maps the joined argv to a canned response. */
function runner(responses: Record<string, unknown>): Run {
  return (args: string[]) => {
    const key = args.join(' ');
    if (!(key in responses)) throw new Error(`unexpected eas call: ${key}`);
    return responses[key];
  };
}

const staged = [
  {
    platform: 'ios',
    branch: 'staging',
    runtimeVersion: 'ios-hash',
    gitCommitHash: 'abc123',
    message: 'feat: something',
  },
  { platform: 'android', branch: 'staging', runtimeVersion: 'android-hash' },
];

describe('promote-resolve', () => {
  it('takes the newest staging group when none is given', () => {
    const run = runner({
      'update:list --branch staging --limit 1': { currentPage: [{ group: 'g-new' }] },
      'update:view g-new': staged,
    });
    expect(promoteResolve.resolve('', run).outputs).toEqual({
      group_id: 'g-new',
      ios_runtime: 'ios-hash',
      android_runtime: 'android-hash',
      commit: 'abc123',
      message: 'feat: something',
    });
  });

  it('uses the given group, trimmed, and truncates the message to 120 characters', () => {
    const run = runner({
      'update:view g-1': [{ ...staged[0], message: 'x'.repeat(200) }],
    });
    const { outputs } = promoteResolve.resolve('  g-1  ', run);
    expect(outputs.group_id).toBe('g-1');
    expect(outputs.message).toHaveLength(120);
    // A single-platform group leaves the other runtime empty, which skips it in the gate.
    expect(outputs.android_runtime).toBe('');
  });

  it('refuses an empty staging branch, an unknown group and a group off staging', () => {
    expect(() =>
      promoteResolve.resolveGroupId('', runner({ 'update:list --branch staging --limit 1': {} })),
    ).toThrow(/No update group on `staging` yet/);
    expect(() => promoteResolve.resolve('g-1', runner({ 'update:view g-1': [] }))).toThrow(
      /Update group g-1 not found/,
    );
    expect(() =>
      promoteResolve.resolve(
        'g-1',
        runner({ 'update:view g-1': [{ ...staged[0], branch: 'production' }] }),
      ),
    ).toThrow(/is on branch "production", not staging/);
  });

  it('is critical only when every platform manifest says forced', async () => {
    const manifests: Record<string, unknown> = {
      'ios-url': { extra: { expoClient: { extra: { updatePolicy: 'forced' } } } },
      'android-url': { extra: { expoClient: { extra: { updatePolicy: 'forced' } } } },
    };
    const fetchJson = (url: string) => Promise.resolve(manifests[url]);
    const updates = [
      { platform: 'ios', manifestPermalink: 'ios-url' },
      { platform: 'android', manifestPermalink: 'android-url' },
    ];
    await expect(promoteResolve.readPolicies(updates, fetchJson)).resolves.toEqual([
      'ios=forced',
      'android=forced',
    ]);
    expect(promoteResolve.isCritical(['ios=forced', 'android=forced'])).toBe(true);
    expect(promoteResolve.isCritical(['ios=forced', 'android=silent'])).toBe(false);
  });

  it('defaults a manifest without updatePolicy to silent and reports an unreadable one', async () => {
    const updates = [{ platform: 'ios', manifestPermalink: 'u' }];
    await expect(promoteResolve.readPolicies(updates, () => Promise.resolve({}))).resolves.toEqual([
      'ios=silent',
    ]);
    await expect(
      promoteResolve.readPolicies(updates, () => Promise.reject(new Error('502'))),
    ).resolves.toEqual(['ios=unreadable: 502']);
  });
});

describe('rollout-resolve', () => {
  const group = [
    { platform: 'ios', branch: 'production', rolloutPercentage: 25, message: 'promote abc' },
  ];

  it('resolves the current rollout of a production group', () => {
    const { rollout, outputs } = rolloutResolve.resolve(
      'g-1',
      50,
      runner({ 'update:view g-1': group }),
    );
    expect(rollout).toBe(25);
    expect(outputs).toEqual({ rollout: '25', message: 'promote abc' });
  });

  it('refuses a non-production group, a completed rollout and a ramp downwards', () => {
    const off = runner({ 'update:view g-1': [{ ...group[0], branch: 'staging' }] });
    expect(() => rolloutResolve.resolve('g-1', 50, off)).toThrow(/only production groups roll out/);

    const done = runner({ 'update:view g-1': [{ ...group[0], rolloutPercentage: undefined }] });
    expect(() => rolloutResolve.resolve('g-1', 50, done)).toThrow(/no in-progress rollout/);

    expect(() => rolloutResolve.resolve('g-1', 10, runner({ 'update:view g-1': group }))).toThrow(
      /below the current 25% — ramps go up only/,
    );
    // Equal is allowed (a re-run of the same ramp is a no-op, not a mistake).
    expect(rolloutResolve.resolve('g-1', 25, runner({ 'update:view g-1': group })).rollout).toBe(
      25,
    );
  });
});

describe('fingerprint-gate (promote)', () => {
  const hashes = { IOS_RUNTIME: 'r-ios', ANDROID_RUNTIME: 'r-android', GROUP: 'g-1' };

  it('reuses a hit on both platforms and cuts nothing', () => {
    const { outputs, refusal, log } = gate('uat', {
      ...hashes,
      IOS_BUILD: 'b-ios',
      ANDROID_BUILD: 'b-android',
    });
    expect(outputs).toEqual({ build_ios: 'false', build_android: 'false' });
    expect(refusal).toBe('');
    expect(log[0]).toBe('ios: HIT — uat build b-ios runs r-ios');
  });

  it('cuts a uat build on a miss only when the checkout fingerprint matches the group runtime', () => {
    const matching = gate('uat', { ...hashes, IOS_FP: 'r-ios', ANDROID_FP: 'r-android' });
    expect(matching.outputs).toEqual({ build_ios: 'true', build_android: 'true' });
    expect(matching.refusal).toBe('');

    const drifted = gate('uat', { ...hashes, IOS_FP: 'other', ANDROID_FP: 'r-android' });
    expect(drifted.outputs).toEqual({ build_ios: 'false', build_android: 'true' });
    expect(drifted.refusal).toBe('Fingerprint gate: refusing g-1 → uat.');
    expect(drifted.log.join('\n')).toContain('--ref <commit> -F target=uat -F update_group_id=g-1');
  });

  it('refuses a production miss outright', () => {
    const { outputs, refusal } = gate('production', { ...hashes, IOS_BUILD: 'b-ios' });
    expect(outputs).toEqual({ build_ios: 'false', build_android: 'false' });
    expect(refusal).toBe('Fingerprint gate: refusing g-1 → production.');
  });

  it('skips a platform that is not in the group', () => {
    const { outputs, refusal, log } = gate('production', {
      GROUP: 'g-1',
      IOS_RUNTIME: 'r-ios',
      IOS_BUILD: 'b-ios',
    });
    expect(outputs).toEqual({ build_ios: 'false', build_android: 'false' });
    expect(refusal).toBe('');
    expect(log).toContain('android: not in the group — skipped');
  });
});

describe('fingerprint-gate (release)', () => {
  it('skips green when the fingerprint is unchanged on every selected platform', () => {
    const { outputs, refusal, log } = gate('release', {
      TAG: 'v1.2.3',
      IOS_BUILD: 'b-ios',
      ANDROID_BUILD: 'b-android',
    });
    expect(outputs).toEqual({ release_ios: 'false', release_android: 'false' });
    expect(refusal).toBe('');
    expect(log.at(-1)).toContain('Release v1.2.3 skipped');
  });

  it('releases on a miss, and on a hit only with force=yes', () => {
    expect(gate('release', { TAG: 'v1', IOS_FP: 'x' }).outputs).toEqual({
      release_ios: 'true',
      release_android: 'true',
    });
    expect(gate('release', { TAG: 'v1', IOS_BUILD: 'b', FORCE: 'yes' }).outputs.release_ios).toBe(
      'true',
    );
  });

  it('honours the platforms input', () => {
    const { outputs, log } = gate('release', { TAG: 'v1', PLATFORMS: 'android' });
    expect(outputs).toEqual({ release_ios: 'false', release_android: 'true' });
    expect(log[0]).toBe('ios: not selected (platforms=android) — skipped');
  });
});

describe('backport helpers', () => {
  const plan = 'v1.2.0/ios=fp-ios:build-1;v1.2.0/android=fp-and:none;';

  it('reads a tag/platform out of the resolve job plan', () => {
    expect(backport.planEntry(plan, 'v1.2.0', 'ios')).toEqual({
      expected: 'fp-ios',
      build: 'build-1',
    });
    expect(backport.planEntry(plan, 'v1.2.0', 'android')).toEqual({
      expected: 'fp-and',
      build: 'none',
    });
    // A tag the plan never mentions refuses instead of publishing to an unknown runtime.
    expect(backport.planEntry(plan, 'v9.9.9', 'ios')).toEqual({ expected: '', build: '' });
  });

  it('maps the platforms input and parses the published group id', () => {
    expect(backport.platformsOf('both')).toEqual(['ios', 'android']);
    expect(backport.platformsOf('ios')).toEqual(['ios']);
    expect(backport.groupOf('[{"group":"g-9"}]')).toBe('g-9');
    expect(backport.groupOf('{"group":"g-9"}')).toBe('g-9');
    expect(backport.groupOf('not json')).toBe('');
  });
});

describe('slack-compose', () => {
  it('flags a staging run that cut new builds as reinstall-required', () => {
    const text = slack.staging({
      UPDATE_STATUS: 'success',
      SHA: '0123456789',
      COMMIT_MESSAGE: 'feat: x',
      BUILD_IOS_STATUS: 'success',
      BUILD_IOS_ID: 'b-ios',
      GET_BUILD_ANDROID_ID: 'b-and',
      UPDATE_GROUP_ID: 'group-id-long',
      IOS_FP: 'iiiiiiiiiiiiiiii',
      ANDROID_FP: 'aaaaaaaaaaaaaaaa',
      WORKFLOW_URL: 'https://run',
    });
    expect(text).toContain('*Staging* · ✅ published · `0123456` — feat: x');
    expect(text).toContain(':warning: *Reinstall required*');
    expect(text).toContain('/builds/b-ios|new build');
    expect(text).toContain('/builds/b-and|current build');
    expect(text).toContain('|group-id>');
    expect(text).toContain('⏭️ skipped (HOSTING disabled)');
    expect(text).toContain('ios `iiiiiiiiiiii` · android `aaaaaaaaaaaa`');
  });

  it('reports a rejected promotion and a refused gate', () => {
    expect(slack.promote({ TARGET: 'uat', APPROVE_STATUS: 'failure' })).toContain('🚫 rejected');
    const refused = slack.promote({ TARGET: 'production', GATE_STATUS: 'failure' });
    expect(refused).toContain('*Promote → production* · ⛔ gate refused');
    expect(refused).toContain('See the run log.');
  });

  it('names the TestFlight and Play outcomes on a release', () => {
    const text = slack.release({
      TAG: 'v1.2.3',
      GATE_STATUS: 'success',
      BUILD_IOS_STATUS: 'success',
      BUILD_IOS_ID: 'b-ios',
      TESTFLIGHT_STATUS: 'success',
      BUILD_ANDROID_ID: 'b-and',
      SUBMIT_STATUS: 'failure',
    });
    expect(text).toContain('*Release v1.2.3* · ❌ submit failed');
    expect(text).toContain('uploaded → TestFlight group `Internal`');
    expect(text).toContain('❌ submit failed (service account?)');
  });

  it('calls a rollout ramped when any of the four update-rollout jobs succeeded', () => {
    const text = slack.rollout({
      TARGET_PCT: '50',
      GROUP_ID: 'group-id-long',
      ROLLOUT_WAS: '25',
      RAMP_STATUSES: 'skipped success skipped skipped',
    });
    expect(text).toContain('*Rollout → 50%* · ✅ ramped');
    expect(text).toContain('was 25%');
    expect(text).toContain('--insights --days 1');
    expect(
      slack.rollout({ TARGET_PCT: '100', RAMP_STATUSES: 'skipped skipped skipped success' }),
    ).toContain('Rollout complete');
    expect(slack.rollout({ RESOLVE_STATUS: 'failure', RAMP_STATUSES: '   ' })).toContain(
      '❌ refused (see the run log)',
    );
  });
});
