# Expo Boilerplate — Build Plan

A public GitHub **template repository** for Expo apps, Bun-only, with a CI/CD pipeline that is
proven on the boilerplate itself (a live, paid EAS project). Every future project starts by clicking
"Use this template" and running `bun run init`.

The design was grilled and agreed in a single session on 2026-09-03, and this file carried both the
locked decisions and the epic/ticket breakdown that built them. Both have moved:

- **The decisions** live in [ADR-0001](docs/adr/0001-locked-architecture-decisions.md), the single
  canonical table. `CLAUDE.md` and `docs/` cite it by row number as "PLAN.md decision N"; row N is
  row N there. A row changes only through a new ADR in [`docs/adr/`](docs/adr/README.md) that
  supersedes it ([Conventions → Changing a locked decision](docs/conventions.md#changing-a-locked-decision)).
- **The build history** — the epics, the tickets and the order they shipped in — lives in the run
  log of `.claude/execution-queue.md` and in the closed GitHub Issues it mirrors. The queue is what
  `/ship-next` works; this file never was.

What the pipeline does today is documented, not planned: [CI overview](docs/ci-overview.md) is the
entry point, [Release ladder](docs/release-ladder.md) the delivery path, and the
[docs site](docs/index.md) indexes the rest.
