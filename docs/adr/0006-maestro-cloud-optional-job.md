# ADR-0006: Maestro Cloud as an opt-in EAS workflow, not a lane

- **Status:** Accepted
- **Date:** 2026-09-13
- **Issue:** #66 (D7 Maestro Cloud optional job; decided with the owner 2026-09-13)

## Context

PLAN.md D7 asks for "Maestro Cloud as an optional job for projects that want device farms".
Maestro Cloud is mobile.dev's hosted device farm (real devices, parallel flows, its own plan);
the template's native lane (`e2e.yml`, ADR-0001 decisions 1–2) already runs the same flows on an
EAS worker's simulator / emulator against a fingerprint-matched cached build. EAS Workflows ships
a pre-packaged `maestro-cloud` job that takes a `build_id`, fetches the build, installs a pinned
Maestro and runs `maestro cloud`, reading `MAESTRO_CLOUD_API_KEY` from the job environment. The
template itself has no Maestro Cloud account, so nothing here can be exercised before a project
adopts it.

## Decision

Maestro Cloud is **`.eas/workflows/e2e-cloud.yml`, a sibling of `e2e.yml`** built on the
pre-packaged `maestro-cloud` job: the same `fingerprint → get-build → repack` chain, then one
`maestro-cloud` job per platform with `include_tags: [<p>]`, `exclude_tags: [quarantine]`,
`maestro_version: 2.10.0` and `MAESTRO_APP_ID` in the job `env`. It runs only on the `e2e:cloud`
PR label or a manual dispatch. It **refuses on a fingerprint miss**: there is no `build_<p>` job, the
platform is skipped and a `refuse` job prints how to get a base build (`E2E (native)` on the PR, or
`bun run e2e:build --build`). It is **off by default** behind the `MAESTRO_CLOUD` repo constant
(`disabled`, dispatch input to override) with the project id as a `proj_REPLACE_ME` literal in the
file; the API key lives only as an EAS secret on `development`. Results land in the Maestro Cloud
console (`maestro_cloud_url` output on the run page) and, per Maestro's docs, as its own PR check.

## Consequences

- A project that pays for Maestro Cloud enables it with one PR (project id + constant flip), one
  `eas env:create` and one label; every other project carries a workflow that never runs a job.
- A label click costs Maestro Cloud minutes plus a repack per platform, never a native build.
- The cached base builds are shared with `e2e.yml`, so a PR that has passed the native lane can be
  re-run on real devices with no extra build.
- Nothing in the file has run: the job is validated by `eas workflow:validate` only. That job
  `env` reaches the flows as `${MAESTRO_APP_ID}`, that `flows: .maestro` (the workspace) is
  accepted, and whether Maestro Cloud posts a PR check are confirmed on the first real run.
- `bun run init` rewrites `MAESTRO_APP_ID` in the file like the other Maestro workflows and leaves
  the project-id placeholder alone (it is not a template identity).

### Rejected

- **A custom job that downloads the build and calls the `maestro cloud` CLI itself** — reinvents
  the pre-packaged job (download, Maestro install, Java) with no documented download step to lean
  on at the time; the built-in job is the supported path.
- **A GitHub Actions job** — splits the native lane across two CI systems and cannot reuse the
  EAS-cached base builds without an extra download hop.
- **Running on every PR** — every PR would spend Maestro Cloud credits for a lane the template
  already covers on EAS workers.
- **Building on a miss** — a label click could cost two full native builds; the native lane owns
  base builds.
- **A schedule** — burns credits on an idle template; a project that wants a nightly can add one.
- **Reading the project id from an EAS env var** — a pre-packaged job's `params` are expressions,
  not shell, so a literal (repo constant) is the only documented form.

### Follow-ups

- First verified run on a project with a Maestro Cloud plan: confirm the env pass-through, the
  workspace `flows` path and the PR check; record findings in `docs/native-e2e.md`.
- A device matrix (`device_model` / `device_os` params) once the first run shows what the
  defaults are.
- Making the check required (`REQUIRED_CHECKS` in `scripts/repo-settings.js`) for projects that
  adopt it.
