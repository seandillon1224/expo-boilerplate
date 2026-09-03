---
name: ship-next
description: Work the build queue — ship GitHub Issues one at a time, each as its own PR branched off main and squash-merged straight back (no stacking), with a fresh subagent per ticket. Trigger with "let's go", "ship the next ticket", "keep shipping", "work the queue", "/ship-next".
disable-model-invocation: false
---

Drive the assembly line defined in `.claude/execution-queue.md` (the ledger). Ship tickets one at a
time. Each ticket is implemented by a **fresh subagent** (clean context), branched off `origin/main`,
opened as a PR, and **squash-merged straight to main immediately** — **no stacking**. Then pull main
and pick up the next ticket. **Auto-continue** through the queue, stopping only on a blocker. The
GitHub issue closes when its PR merges (`Closes #N` in the PR body).

> Why no stacking: land setup on main as fast as possible; every PR is conflict-free and review-trivial.

## Each turn

1. Read the ledger. Pick the **first `[ ]` (pending)** item in queue order.
   - Skip `[M]` (manual/human), `[B]` (blocked), `[D]` (deferred by the user) — list them in the
     wrap-up, never auto-PR them. `[D]` stays parked until the user flips it back to `[ ]`.
   - `[S]` (needs secrets): still build the code + PR, but stub/guard the secret-dependent path and
     flag what config the human owes.
2. Pre-flight: `git status` must be clean (else STOP). `git checkout main && git pull --ff-only origin main`.
3. Mark the item `[~]` in the ledger. `gh issue edit <n> --add-label in-progress`.
4. **Spawn a fresh subagent** (`Agent`, `general-purpose`) with the issue number, title, full body
   (`gh issue view <n>`), the relevant `PLAN.md` decisions, and the Subagent brief below.
5. On **success** (PR URL returned): `gh pr merge <n> --squash --delete-branch`; sync main; ledger →
   `[x]` + run-log line `#N | <branch> | <PR url> | merged | <date>`; remove `in-progress` label.
   Emit `✅ #N shipped → <PR url>` and continue.
6. On **blocker**: ledger → `[B]` with a one-line reason; remove `in-progress`; STOP and report.

## Subagent brief (pass verbatim, filled in)

> You implement ONE GitHub issue as one PR branched off `origin/main`.
>
> 1. `git fetch origin && git checkout -b t<num>-<slug> origin/main`.
> 2. Read `CLAUDE.md` and the relevant existing code first; implement ONLY this issue's scope.
>    Keep the diff tight — do not pull in sibling tickets.
> 3. Validate: `bun run lint && bun run typecheck && bun run test && bun run knip`. If something
>    can't run for an environmental reason, say so in your report.
> 4. If you cannot complete it (missing secret, needs a human account action, a design call you
>    can't make safely), STOP — make no PR — and return a clear blocker reason.
> 5. Commit with a Conventional Commit message (lowercase subject) whose body ends with
>    `Closes #<num>`. Stage only relevant files (never `.env*`). `git push -u origin <branch>`.
> 6. `gh pr create --base main --label epic:<E>` with `## Summary` bullets + `## Test plan`.
> 7. Return: the PR URL, a 3-sentence summary, and any follow-ups the human still owes.

## Stop conditions

Blocker/error from a subagent; a failed merge or conflict; the next item needs something a human
must do first; only `[M]`/`[B]`/`[D]` remain; dirty tree at pre-flight.

## Wrap-up

Report: shipped count, stop reason, and the `[M]`/`[S]`/`[B]` items waiting on the human with what each needs.
