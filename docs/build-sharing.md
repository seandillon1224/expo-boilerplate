# Build sharing

How builds reach people (PLAN.md decision 12). Staging and UAT builds are **EAS internal
distribution**: every build has a hosted install page with a QR code, iOS is ad hoc with self-serve
device registration, and there is no Firebase App Distribution. Production release candidates go to
the **TestFlight internal group** and the **Play internal track** from `release.yml`. Links are
pushed to people by two jobs: `slack` (staging / uat / production / release runs) and
`github-comment` (PR runs). Engineers open builds with **Expo Orbit**.

| Audience                   | Read                                                                             |
| -------------------------- | -------------------------------------------------------------------------------- |
| Designers, PMs, testers    | [Installing the staging app](install-staging-app.md) (no CLI)                    |
| iPhone testers, first time | [Getting the staging app on your iPhone](device-onboarding.md)                   |
| Engineers                  | this page: [Slack](#slack-channel), [Orbit](#expo-orbit)                         |
| Owner (one-time setup)     | [Human setup checklist](environments-and-secrets.md#human-setup-checklist-owner) |

## Where a build is shared from

- **Install page** — expo.dev → project → **Builds** → the build. The page carries the QR code, an
  **Install** button (iOS: the ad hoc `.ipa` over Apple's OTA install; Android: the `.apk`) and
  **Open with Orbit**. It is what every Slack post and PR comment links, and testers do not need an
  Expo account to open it.
- **Slack** — one post per `deploy-staging.yml` run (below), one per `promote.yml` run, one per
  `release.yml` run.
- **PR comment** — `e2e.yml` (`comment` job, `type: github-comment`) links the build each Maestro
  lane ran on ([Native E2E → PR comment](native-e2e.md#pr-comment)); `preview-web.yml` links the
  web preview ([Release ladder → PR previews](release-ladder.md#pr-previews-web-automatic)). PR
  builds are the `development` variant and are meant for engineers, not for sharing with testers.
- **TestFlight / Play internal** — only `release.yml` (`vX.Y.Z` tag) puts a build there
  ([Release ladder → Store release](release-ladder.md#store-release-tag)); testers are added on the
  store side (App Store Connect → TestFlight → internal group; Play Console → Internal testing →
  testers list), not on EAS.

## Slack channel

The `slack` jobs are **custom steps**, not `type: slack` — eas-cli's validator rejects an
expression in that job's `webhook_url`, and a webhook is a secret. Each job composes Slack
mrkdwn from `after.<job>` outputs into `slack.txt` and `POST`s it with Node's `fetch`; the URL
never reaches the log. The only configuration is one variable:

| Variable            | Where                                                                           | Read by                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SLACK_WEBHOOK_URL` | EAS environment variable, `secret`, environments `preview` **and** `production` | `deploy-staging.yml` + `promote.yml` (`environment: preview`), `release.yml` (`environment: production`) |

While it is unset the job prints `SLACK_WEBHOOK_URL is not set … skipping` and exits 0, so a run
stays green without it; no repo constant to flip. It is never stored in GitHub or in the repo.

### Create the channel and webhook (owner, once)

1. Create the channel (e.g. `#releases`) and invite everyone who installs builds — designers and
   PMs included; the post is their install link.
2. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch** → name
   it (e.g. `EAS releases`), pick the workspace.
3. **Incoming Webhooks** → toggle **Activate Incoming Webhooks** on → **Add New Webhook to
   Workspace** → choose the channel → **Allow**. Copy the `https://hooks.slack.com/services/…`
   URL. One webhook = one channel; a second channel (say `#releases-prod` for `release.yml`) is a
   second webhook set only on the `production` environment.
4. Store it on EAS:

```sh
bun run eas env:set --scope project --environment preview --environment production \
  --name SLACK_WEBHOOK_URL --value https://hooks.slack.com/services/... \
  --visibility secret --type string --non-interactive
bun run eas env:list --environment preview --format long   # shows the name, never the value
```

5. Tick the checklist line in
   [Environments and secrets](environments-and-secrets.md#human-setup-checklist-owner). The next
   push to `main` posts.

Rotate by repeating step 3 (a new webhook), running the same `env:set` (it updates in place) and
deleting the old webhook in the Slack app; nothing in the repo changes.

### What the staging post contains

```text
Staging · ✅ published · `1a2b3c4` — feat: onboarding carousel (#118)
⚠️ Reinstall required — the native fingerprint changed, new staging builds were cut. Installed apps will NOT receive this update.
• iOS: new build — install page + QR
• Android: new build — install page + QR
• Update: 9f8e7d6c · `bun run eas update:view <group-id>`
• Web: https://expo-boilerplate--staging.expo.app
• Fingerprint: ios `…` · android `…` · workflow run
```

Line by line:

- **Verdict** — `✅ published` / `❌ update failed` / `⏭️ update skipped`, short SHA and the first
  120 characters of the commit message (`(manual run)` for a dispatch).
- **Reinstall flag** — `⚠️ Reinstall required` whenever a `build_<p>` job succeeded (the native
  fingerprint changed, so the update only reaches the new build); otherwise
  `JS-only change: installed staging apps pick it up on next launch`. The rule is explained under
  [Release ladder → Staging](release-ladder.md#staging-automatic).
- **iOS / Android** — the install page link, labelled `new build` (cut this run) or
  `current build` (cache hit). iOS reads `⏭️ no build for this fingerprint (IOS_BUILDS disabled)`
  until the ad hoc credentials exist, `❌ build failed (…)` on a red build.
- **Update** — the group id linked to expo.dev plus the CLI to inspect it; this is the id
  `promote.yml` takes.
- **Web** — the `staging` alias URL, or `⏭️ skipped (HOSTING disabled)`.
- **Fingerprint** — both hashes (12 chars) and the workflow run.

`promote.yml` posts the same shape for `uat` / `production` (verdict, group ids, install links,
reinstall flag when uat builds were cut); `release.yml` posts the verdict, build links and where
each platform landed (TestFlight internal group / Play internal track). The `expo.dev` account/slug
prefix in the links is a literal in each workflow; `bun run init` (T7.1) rewrites it.

### Test it

- **Webhook alone** (no run, nothing published):

  ```sh
  node -e 'fetch(process.env.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "*Staging* · webhook test" }) }).then((r) => console.log(r.status))'
  ```

  with `SLACK_WEBHOOK_URL` exported in that shell (not in `.env.local`). `200` = the channel got
  it; `403` / `404` = revoked or mistyped URL.

- **The job itself**: `bun run eas workflow:run .eas/workflows/deploy-staging.yml` (a dispatch
  run; publishes a real `manual staging publish of <sha>` update, hits the build cache, posts
  `(manual run)`), then the run page on expo.dev → **Slack** job log: `posted`, or the
  skip line when the variable is missing from the `preview` environment.

- **Message edits**: the text lives in the `Compose message` step of each workflow. After
  editing, `bun run eas workflow:validate .eas/workflows/deploy-staging.yml` (cap 16 KiB per
  file) — every ternary must guard its string functions with `|| ''`, because the evaluator
  resolves both branches and a skipped job has no outputs.

## Expo Orbit

[Expo Orbit](https://expo.dev/orbit) is the menu-bar app engineers use to open any EAS build on a
simulator, emulator or connected phone in one click — no `xcrun` / `adb install`, no downloading
`.tar.gz` / `.apk` files by hand.

1. **Install**: `brew install --cask expo-orbit` (macOS; there is also a Windows preview on the
   Orbit page). Launch it; it lives in the menu bar.
2. **Sign in**: menu bar icon → **Settings** → **Log in** with your Expo account (the one that is a
   member of the project's EAS account). Orbit then lists the account's projects and their recent
   builds under **Projects**.
3. **Open a build**: any of
   - expo.dev build page → **Open with Orbit** (the same page every Slack post and PR comment
     links);
   - menu bar → **Projects** → the project → pick the build;
   - drag a downloaded `.apk`, simulator `.tar.gz` / `.app`, or an `.ipa` onto the menu-bar icon;
   - paste a build or update URL into Orbit's search field.
4. **Pick a target**: Orbit shows the simulators, emulators and connected devices it can see.
   Which build runs where:

   | Profile (`eas.json`)                   | Target                                                                    |
   | -------------------------------------- | ------------------------------------------------------------------------- |
   | `development-simulator`, `e2e-ios-sim` | iOS simulator                                                             |
   | `development`, `staging`, `uat` (iOS)  | a registered iPhone over USB (macOS 14+); simulators refuse device builds |
   | any Android profile (`.apk`)           | emulator or a USB device with USB debugging on                            |

   A device that Orbit cannot see needs the usual fixes: Xcode's simulators installed, an emulator
   created in Android Studio, `adb devices` listing the phone.

5. **Updates**: on a `development` build, Orbit's **Updates** tab (or an `eas update` URL from
   expo.dev → Updates) launches that update group in the dev client — the fastest way to check
   what a `staging` group would show before promoting it.

Orbit does not replace the install page for testers: it needs an Expo account with project access
and a computer, which is exactly what the [one-pager](install-staging-app.md) avoids.
