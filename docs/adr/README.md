# Architecture decision records

One short file per architecture decision, so the _why_ behind the template survives the people who
made it and a change to a decision is a diff, not a conversation. `CLAUDE.md` and `docs/` cite
decisions as "PLAN.md decision N"; the table they cite lives here, and only here, as
[ADR-0001](0001-locked-architecture-decisions.md) — `PLAN.md` keeps no copy. A project created with
`bun run init` inherits this folder as-is (it describes the template the project started from).

## Adding one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-kebab-title.md`, where `NNNN` is the
   next number after the highest one in this folder.
2. Fill in the sections; keep it to one screen. Link the issue and the grill session if there was
   one ([Conventions → Changing a locked decision](../conventions.md#changing-a-locked-decision)).
3. If it changes a row of the locked-decisions table, mark that row in
   [ADR-0001](0001-locked-architecture-decisions.md) **superseded** with a link to the new record,
   in the same PR. `PLAN.md` has no row to update.
4. Add the file's H1 to the [index](#index) below, verbatim. The docs site's Decisions sidebar
   needs no edit: `docs/.vitepress/config.mts` reads this folder and uses each file's H1, so a new
   `NNNN-*.md` (anything but `0000-template.md`) is picked up automatically.

## Status values

- **Proposed** — written up, not yet agreed.
- **Accepted** — agreed and in effect.
- **Superseded** — replaced by a later ADR (link it); kept for history.

## Index

| ADR                                           | Title                                                                      | Status   |
| --------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| [0001](0001-locked-architecture-decisions.md) | ADR-0001: Locked architecture decisions                                    | Accepted |
| [0002](0002-release-please-versioning.md)     | ADR-0002: release-please owns versioning and the release tag               | Accepted |
| [0003](0003-update-policies.md)               | ADR-0003: Update policies — silent, opt-in, forced, critical               | Accepted |
| [0004](0004-oxlint-front-pass.md)             | ADR-0004: oxlint as a fast front pass in front of ESLint                   | Accepted |
| [0005](0005-a11y-hierarchy-audit.md)          | ADR-0005: Accessibility E2E as a hierarchy audit, not a screen-reader flow | Accepted |
| [0006](0006-maestro-cloud-optional-job.md)    | ADR-0006: Maestro Cloud as an opt-in EAS workflow, not a lane              | Accepted |
| [0007](0007-flashlight-android-perf-hook.md)  | ADR-0007: Flashlight as an opt-in hook of the Android E2E job, not a lane  | Accepted |
| [0008](0008-multi-runtime-ota-backports.md)   | ADR-0008: Multi-runtime OTA backports as a manual, approval-gated workflow | Accepted |
| [0009](0009-docs-site.md)                     | ADR-0009: A VitePress docs site on GitHub Pages                            | Accepted |
