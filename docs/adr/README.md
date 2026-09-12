# Architecture decision records

One short file per architecture decision, so the _why_ behind the template survives the people who
made it and a change to a decision is a diff, not a conversation. `CLAUDE.md` and `docs/` cite
decisions as "PLAN.md decision N"; the table they cite is recorded here as
[ADR-0001](0001-locked-architecture-decisions.md), which a project created with `bun run init`
inherits as-is (it describes the template the project started from).

## Adding one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-kebab-title.md`, where `NNNN` is the
   next number after the highest one in this folder.
2. Fill in the sections; keep it to one screen. Link the issue and the grill session if there was
   one ([Conventions → Changing a locked decision](../conventions.md#changing-a-locked-decision)).
3. If it changes a row of the locked-decisions table, set the old record's entry to **Superseded**
   with a link to the new one and update the row in `PLAN.md` in the same PR.

## Status values

- **Proposed** — written up, not yet agreed.
- **Accepted** — agreed and in effect.
- **Superseded** — replaced by a later ADR (link it); kept for history.

## Index

| ADR                                           | Title                         | Status   |
| --------------------------------------------- | ----------------------------- | -------- |
| [0001](0001-locked-architecture-decisions.md) | Locked architecture decisions | Accepted |
