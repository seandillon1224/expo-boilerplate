# Security policy

## Reporting a vulnerability

Report privately through **GitHub Security Advisories**: the repository's **Security** tab →
**Report a vulnerability**. That opens a private advisory only the maintainers can read, and it is
the only channel — please do not open a public issue, a pull request or a discussion for a
vulnerability, and do not mail an individual maintainer.

Include what you would put in a bug report: affected version or commit, platform, the steps to
reproduce, and the impact you think it has. You will get an acknowledgement, and the advisory thread
is where the fix, the disclosure and any CVE are coordinated.

## Supported versions

| Version                 | Supported                                 |
| ----------------------- | ----------------------------------------- |
| `main`                  | Yes                                       |
| The latest `vX.Y.Z` tag | Yes — fixes ship as a patch release on it |
| Anything older          | No                                        |

Fixes land on `main` first and reach installs as an OTA update or a store release, depending on
whether the fix changes native code ([release ladder](docs/release-ladder.md)). A fix that has to
reach an older store build is a backport
([release ladder → Backports](docs/release-ladder.md#backports-older-runtimes)).

## What this repo already does

- **No secrets in git.** A `gitleaks` scan is a required check on every PR (`Secret scan` in
  `.github/workflows/ci.yml`, config in `.gitleaks.toml`) and `bun run secrets:scan` is the same
  scan locally. `.env*` files are git-ignored; `.env.local` is pulled from EAS, never committed.
- **Secrets live in EAS and GitHub only.** Build- and runtime configuration comes from EAS
  environment variables and GitHub Actions secrets / environments — never from a file in the repo
  ([environments and secrets](docs/environments-and-secrets.md)). Anything named `EXPO_PUBLIC_*` is
  embedded in the client bundle and is therefore **not** a secret; those are validated against a Zod
  schema and read only through `@/lib/env`.
- **Third-party GitHub Actions are pinned to a commit SHA**, never a tag or branch, so an upstream
  account compromise cannot re-point them at code that runs with our token
  ([conventions → CI](docs/conventions.md#third-party-actions-are-pinned-to-a-commit-sha)).
- **Least-privilege tokens.** Workflows default to `contents: read`; a job that needs more declares
  it itself.
- **Dependencies** are kept current by Renovate (`.github/renovate.json5`), and every update goes
  through the same required checks.
- **Production releases are gated** by a required reviewer on the `production` GitHub Environment
  and by the approval step in the EAS promotion workflows.
