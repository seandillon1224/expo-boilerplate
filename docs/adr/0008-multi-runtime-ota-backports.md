# ADR-0008: Multi-runtime OTA backports as a manual, approval-gated workflow

- **Status:** Accepted
- **Date:** 2026-09-13
- **Issue:** #61 (D2 multi-runtime OTA backports; decided with the owner 2026-09-13)

## Context

PLAN.md D2 asks for "shipping OTA-safe commits to N previous store runtime versions for parity
with the long tail". Under the template's update model the runtime version **is** the native
fingerprint (`runtimeVersion: { policy: 'fingerprint' }`, PLAN.md decision 2; `fingerprint.config.js`
keeps `version` and `extra` out of it), and `eas update` has no runtime-version override: the
runtime of a publish is computed from the checked-out tree. So an update published from `main`
reaches only the installs whose binary has `main`'s fingerprint. Every store release whose
fingerprint moved leaves a runtime behind, and the installs on it — users who have not updated
from the store — keep receiving nothing from the ladder ([ADR-0002](0002-release-please-versioning.md)
makes the fingerprint change rarer, not impossible). The only way to reach such a runtime is to
publish from a tree whose fingerprint equals it: the release tag's tree plus the fix. There is no
staging or UAT build of an old runtime, so the ladder ([ADR-0003](0003-update-policies.md), PLAN.md
decision 3) cannot verify a backport the way it verifies a promotion.

## Decision

Backports are **`.eas/workflows/backport.yml`, a `workflow_dispatch`-only workflow dispatched
once per backport**, with explicit targets: `tags` (comma-separated store release tags, each
naming a runtime through its store build's fingerprint), `fix` (a commit SHA on `main` to
cherry-pick), or `ref` (a prepared `backport/<tag>` branch for exactly one tag, no cherry-pick),
plus `rollout_percentage`, `platforms` and `message`. Shape: `resolve` (validates the inputs,
fetches the tags, checks the fix is on `origin/main`, and prints per tag and platform the
fingerprint of the **clean tag tree** and the production store build that runs it, found with
`eas build:list --fingerprint-hash` — by hash, not by the tag's commit, because `release.yml`
skips a tag whose fingerprint is unchanged) → `approve` (`require-approval`) → `backport`, one
custom job that **loops over the tags in shell** (EAS workflows have no matrix): per tag, check out
the tag and `git cherry-pick -x` the fix (or check out the prepared ref and require the tag to be
its ancestor), `bun install`, compute both platform fingerprints with the repo's own
`bun run fingerprint`, and require each to equal the clean tag's hash **and** that hash to have a
store build; then `eas update --channel production --environment production` for the passing
platforms only, with `--rollout-percentage` and a `backport <fix7> onto <tag>: …` message. A
cherry-pick conflict or a fingerprint mismatch fails that tag (or platform) with the local recipe
/ "needs a fix release" printed; every tag is attempted and the job exits non-zero at the end if
any failed. It publishes **straight to `production`**: this is the one sanctioned skip of the
ladder, because no rung below production can run an old runtime. The safety net is the fingerprint
gate, the approval with the resolved facts printed first, the staged rollout, and the CLI rollback
path already in the runbook.

## Consequences

- Users on an older store runtime can get a JS-only fix without a store release, at the cost of one
  dispatch, one approval and one publish per run; the runbook
  ([Release ladder → Backports](../release-ladder.md#backports-older-runtimes)) shows how to pick
  the runtimes that still have users (`update:list --runtime-version`, `build:list`, EAS Update
  insights) — nothing is automatic, and nobody backports to a runtime nobody runs.
- A backport group lives on the `production` branch next to the promoted ones, under its own
  runtime version. `update:list --branch production` interleaves them; filter by
  `--runtime-version`. Rollback is the normal CLI path per runtime (`update:rollback <group>`).
- A native fix can never be backported (the gate refuses); the answer is a fix release.
- **Unverified.** The repo has no store release, so the workflow has only passed
  `eas workflow:validate`. The first real run must confirm: that `git` inside a custom job can
  fetch tags / `main` / a branch from origin and cherry-pick with the configured identity; that
  `bun install --frozen-lockfile` works on an old tag's tree on the worker; that `bun run eas update`
  picks up the checked-out tree's fingerprint (the update's `runtimeVersion` must equal the store
  build's); that job outputs of the size `plan` produces survive `set-output`; and that the
  approval page shows the `resolve` log to the approver. Record the findings in the runbook.
- `scripts/init.js` rewrites the expo.dev link in the file (`workflowUrls`), `docs/ci-overview.md`
  and `CLAUDE.md` gain the workflow, the README's "Commonly added next" loses the bullet.

### Rejected

- **Automatic backport on every fix** — conflicts would be silent failures in a push-triggered run,
  and every fix would mean N publishes whether or not the runtimes still have users.
- **Label-driven (`backport:v1.2.0` on the PR)** — needs GitHub Actions in the loop to read labels
  and dispatch, for a workflow that is dispatched a few times a year.
- **Through the ladder** — a staging / UAT build of a dead runtime is a paid build with no testers
  on it; the promotion would verify nothing.
- **Automatic "last N" targets** — backports to runtimes nobody runs; the runbook's insight
  queries pick the targets instead.
- **A manual `runtimeVersion` override** — `eas update` has none, and faking one by editing the
  config would publish a bundle built from `main` against a native surface it was not built for.
- **One job per tag (fixed N)** — a fixed slot count and N copies of the same step; the shell loop
  attempts every tag and reports per tag.

### Follow-ups

- First verified run after the first store release (the list above); open an issue for anything
  that turned into a failure.
- Whether to add a Slack post (`backport` job) in the style of `promote.yml`.
- Whether Sentry source maps are uploaded for backports: the job runs `bun run sentry:sourcemaps`
  best-effort after the publish, from the tag's tree; confirm the script exists there and that the
  `SENTRY_*` variables on `production` reach it.
