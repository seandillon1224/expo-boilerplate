# ADR-0004: oxlint as a fast front pass in front of ESLint

- **Status:** Accepted
- **Date:** 2026-09-12
- **Issue:** #64 (D5 oxlint; the grill outcome is the last comment on the issue)

## Context

`bun run lint` is the first job of the JS gate and the slowest of the fast ones: a full ESLint run
is ≈ 3.6 s on 72 files, most of it rules that a Rust linter runs in ≈ 0.1 s. oxlint 1.82 natively
covers eslint core / typescript / react / jsx-a11y / import / unicorn / jest / promise / node, but
has no equivalent of `eslint-config-expo`, `eslint-plugin-react-native-a11y`, `simple-import-sort`
or the local `require-testid` rule, and its JS-plugin bridge (`jsPlugins`) is alpha. So oxlint
cannot replace ESLint yet; the question was whether it earns a place in front of it.

While wiring this up it turned out that `expo lint` had never run ESLint in this repo: it spawns
`bun eslint src …`, and Bun resolves a local `./eslint` path before a `node_modules/.bin` entry,
so the repo's `eslint/` plugin folder was being executed (exit 0, no output) instead of ESLint —
locally and in the `Lint` CI job.

## Decision

oxlint runs first, with its defaults; ESLint stays the owner of everything oxlint cannot express.

1. **Rule set = oxlint defaults.** `.oxlintrc.json` at the repo root carries only ignore patterns
   (the same set as the ESLint `ignores` block) and any per-path override needed to stay green. No
   `@oxlint/migrate`, no extra categories, no `jsPlugins` (alpha).
2. **Placement = inside `bun run lint`**: `"lint": "oxlint && expo lint"`. The `Lint` CI job, the
   required-checks set (`scripts/repo-settings.js`) and `lefthook.yml` are untouched — no separate
   job, no pre-commit change.
3. **Overlap removal.** `eslint-plugin-oxlint`'s `buildFromOxlintConfigFile('.oxlintrc.json')` is
   spread into `eslint.config.js` after our rules block, so ESLint stops reporting rules oxlint
   already runs. Our explicit `unused-imports/*` rules remain in effect (they carry the `^_`
   policy); `bunx eslint --print-config src/components/animated-icon.tsx | grep unused-imports`
   is the check.
4. **Severity policy matches ESLint.** Warnings print, only errors fail — no `--deny-warnings`.
5. **Trial nits stay.** The no-config trial reported only warnings (`animated-icon.tsx` unused
   var, `unicorn/prefer-string-starts-ends-with` in two `scripts/e2e-*.js`, `no-useless-escape`
   in `scripts/init.js`); only errors would have been fixed, and there were none.
6. **Versions in lockstep.** `oxlint` and `eslint-plugin-oxlint` are devDependencies pinned to
   the same exact version (1.82.0) and grouped as `oxlint` in `.github/renovate.json5`, because
   the plugin's "rules oxlint owns" list must match the binary.
7. **Docs.** This record; the `bun run lint` line in `CLAUDE.md`, the Toolchain bullet in
   `docs/conventions.md`, the `Lint` rows in `docs/js-gate.md` and `docs/ci-overview.md`.
8. **The local plugin folder is `eslint-rules/`**, no longer `eslint/`, so that `bun eslint …`
   (what `expo lint` spawns) resolves the ESLint binary again.

## Consequences

- `bun run lint` is oxlint (≈ 0.1 s) followed by a real ESLint run (≈ 2.4 s cold, ≈ 0.3 s with
  `expo lint`'s cache in `.expo/cache/eslint/`). Before this change the ESLint half was a no-op.
- ESLint reports fewer rules than before (the ones oxlint owns are turned off there); the same
  problems now surface from oxlint, in its output format, before ESLint starts. Nothing is gated
  that was not gated before, and the `Lint` check is now actually enforcing ESLint's rules — a
  branch that was green only because ESLint never ran will show its findings on the next push.
- Two linters mean two config files. Anything project-specific (rule choices, testID policy, a11y,
  import order) still lives in `eslint.config.js`; `.oxlintrc.json` should stay ignore-patterns
  and per-path overrides only.
- The two packages must be bumped together: a Renovate PR for one without the other is a sign the
  `oxlint` group in `renovate.json5` was broken.
- **Revisit when oxlint's JS-plugin bridge leaves alpha**: consider moving `require-testid` and
  the react-native-a11y rules to oxlint plugins and dropping ESLint entirely (an ADR superseding
  this one).
