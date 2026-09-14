# Onboarding (day 1)

You have just been given access to this repo. This page is the shortest path from a clone to a
merged PR; everything on it links to the page that owns the detail. Setup that only one person ever
does — accounts, credentials, GitHub settings — is not here, it is the
[owner checklist](owner-checklist.md).

## Get the app running

1. **Clone and install.** `bun install` — Bun only; a `preinstall` guard rejects npm / yarn / pnpm,
   and `bun.lock` is the only lockfile ([Conventions → Toolchain](conventions.md#toolchain)).
2. **Check your toolchain.** `bun run doctor` prints every tool the lanes need, the version found,
   the version expected and a fix hint for each. It exits 1 only on a missing _required_ tool
   (Bun / Node / git), so warnings about Maestro, Xcode or the Android SDK are fine until you work
   that lane ([Toolchain check](doctor.md)).
3. **Get added to the EAS project.** Ask the owner to invite your Expo account to the organisation
   that owns the project (expo.dev → account → Members), then `bun run eas login`. Without it the
   next two steps fail with a permissions error
   ([Environments and secrets](environments-and-secrets.md)).
4. **Pull the environment.** `bun run env:pull` writes `.env.local` from the EAS `development`
   environment. Never hand-edit it — EAS is the source of truth, and `bun run env:check` validates
   what you have against the Zod schema
   ([Environments and secrets → EAS environment variables](environments-and-secrets.md)).
5. **Install the dev client.** The app uses native modules, so Expo Go will not run it. Take the
   latest `development` build from expo.dev (or an install link posted in Slack) and install it with
   [Expo Orbit](build-sharing.md) — on iOS your device has to be registered first
   ([Device onboarding](device-onboarding.md)). A simulator / emulator needs no registration.
6. **Start it.** `bun run ios` (or `android` / `web`) starts the dev server against that build, with
   [Rozenite DevTools](rozenite.md) on.

## Make a change and ship it

7. **Branch off `main`** and make the change. The rules that lint and hooks enforce — `testID` on
   every pressable, strings through `t()`, env through `@/lib/env`, no `ios/` or `android/` folders
   — are in [Conventions](conventions.md); the full script list with flags is
   [Commands](commands.md).
8. **Run the gate locally** before you push:
   `bun run lint && bun run typecheck && bun run test && bun run knip && bun run format:check && bun run i18n:check`.
   Lefthook runs the fast half on commit and the slow half on push anyway
   ([Conventions → Hooks](conventions.md#hooks-lefthook)).
9. **Commit in Conventional Commits.** `feat:` / `fix:` / `chore:` …, lowercase subject — commitlint
   checks the message, and the same config checks your PR title, because the squash merge uses it
   ([Conventions → Commits and PR titles](conventions.md#commits-and-pr-titles)).
10. **Open the PR** with `## Summary`, `## Test plan` and `Closes #n` (the template prefills them).
    One ticket, one PR, squash-merged as soon as it is green.

## What the checks mean

| Check               | Runs                                                                                                                                            | Read                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CI` jobs           | Lint, typecheck, unit, knip, format, commitlint, secret scan, bundle budgets, Maestro web, docs build — all required                            | [JS gate](js-gate.md)                                                                          |
| `E2E (native)`      | Maestro flows on iOS + Android, from a fingerprint-matched build repacked with your JS                                                          | [Native E2E](native-e2e.md)                                                                    |
| `Perf (Reassure)`   | Render-perf compare against the base commit; informational                                                                                      | [Render-perf tests](perf-tests.md)                                                             |
| `Fingerprint drift` | Comments when your change alters the native fingerprint; informational, but it means a new build is needed before the next production promotion | [Release ladder → Fingerprint drift](release-ladder.md#fingerprint-drift-on-prs-informational) |
| `Preview web`       | Deploys the web build to a `pr-N` alias and comments the URL                                                                                    | [Release ladder → PR previews](release-ladder.md#pr-previews-web-opt-in)                       |

Every job in both systems, what triggers it and what to do when one is red:
[CI overview](ci-overview.md). A Maestro flow that fails then passes on retry is not yours to
delete — file it against the [flake budget](native-e2e.md#flake-budget).

## After the merge

Your commit is on `staging` within a few minutes of the squash merge, as an OTA update. UAT and
production are manual, approval-gated republishes of that same update group, and store builds come
from a `vX.Y.Z` tag that release-please pushes. The whole runbook, including rollback and hotfix:
[Release ladder](release-ladder.md).
