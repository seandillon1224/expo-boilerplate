# Toolchain check (`bun run doctor`)

`bun run doctor` (`scripts/doctor.js`) checks the tools this project needs, prints one row per
tool — status, the version found, the version expected — and, for every row that is not `ok`, the
exact install command (Homebrew on macOS; Linux where it differs). It is also the first `init`
step (`--skip-doctor` to skip). No network access except `eas whoami`.

| Check             | Expected (source)                                                                        | Required | Lane it unlocks                            |
| ----------------- | ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| **Bun**           | `>= 1.2.0` — `bun.lock` is a text lockfile (`saveTextLockfile` in `bunfig.toml`)         | yes      | everything                                 |
| Lockfiles         | only `bun.lock`; warns on `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml`           | —        | Bun-only installs                          |
| **Node**          | major of `.node-version` (22); older is `MISSING`, newer only warns                      | yes      | scripts, lefthook, eas-cli                 |
| **git**           | `>= 2.28`                                                                                | yes      | everything                                 |
| lefthook hooks    | `.git/hooks/pre-commit` written by lefthook (`bunx lefthook install`, runs on `prepare`) | —        | pre-commit / commit-msg / pre-push hooks   |
| EAS CLI           | major of `eas-cli` in `package.json`, resolved via `bun run eas --version`               | —        | EAS build / update / workflows, `env:pull` |
| EAS login         | `bun run eas whoami --non-interactive` succeeds, or `EXPO_TOKEN` is set                  | —        | `e2e:build`, `env:pull`, `devices:*`       |
| GitHub CLI + auth | `gh` installed, `gh auth status` logged in                                               | —        | `repo:settings:*`                          |
| Maestro           | `>= EXPECTED.maestroMin`; CI pins `EXPECTED.maestroPinned`; `~/.maestro/bin` ok          | —        | `e2e:web`, `e2e:ios`, `e2e:android`        |
| Xcode             | `>= 16.0` + at least one iOS simulator; macOS only (`skip` elsewhere)                    | —        | iOS lane                                   |
| Android SDK       | `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) exists, `adb` and `emulator` resolvable           | —        | Android lane                               |
| Java              | JDK `>= 17` — what the Maestro CLI and `@expo/repack-app`'s build-tools need             | —        | Maestro, Android repack                    |

Version floors live once, in `EXPECTED` at the top of `scripts/doctor.js` — this table names the
key rather than repeating the number. The Maestro pin (`EXPECTED.maestroPinned`) is the same value
as `maestro_version:` in `.eas/workflows/*.yml` and `MAESTRO_VERSION:` in `.github/workflows/ci.yml`;
the Maestro custom manager in `.github/renovate.json5` bumps all three in one PR, so never edit one
of them alone.

Statuses: `ok`, `warn` (missing / incompatible / logged out, but only an optional lane is
affected), `MISSING` (a required tool — Bun, Node, git — is absent or incompatible), `skip` (not
applicable on this platform, or depends on a row that is not `ok`).

Flags and exit codes:

| Invocation                | Exit 1 when                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `bun run doctor`          | a required tool is `MISSING`; warnings exit 0               |
| `bun run doctor --strict` | any `MISSING` **or** `warn` (CI, #56); `skip` never fails   |
| `bun run doctor --json`   | same rules; prints `{ rows, summary }` instead of the table |

An unknown flag exits 2 (the repo-wide usage code — `docs/conventions.md` → Scripts parse
arguments and exit the same way).

The expected versions live in one `EXPECTED` constant at the top of `scripts/doctor.js`, each
with the reason for the number; `scripts/__tests__/doctor.test.ts` drives every check with a fake
`run()` so the tests never touch a real binary.
