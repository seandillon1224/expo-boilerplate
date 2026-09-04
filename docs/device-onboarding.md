# Getting the staging app on your iPhone

For testers, designers, PMs — anyone who is not an engineer. Android users can skip to
[Android](#android). How to actually _install_ the app once your phone is set up (Expo Orbit, the
install page, Slack links) is a separate one-pager: T5.6 / #45.

## Why there is a setup step at all

Apple only lets a test app run on phones the team has listed in advance. Listing your phone takes
two minutes and happens once per phone; after that every new build just works.

## Step 1 — ask an engineer for a registration link

An engineer produces a link + QR code for you in one of two ways (they don't need your phone):

- In a terminal: `bun run devices:add` → **Website**. EAS prints a link and a QR code.
- On [expo.dev](https://expo.dev): project → **Workflows** → **Register test device** → **Run**
  (Apple Team ID, optional note with your name). The run pauses and shows the link + QR code.

Either way, they send you the link or the QR code.

## Step 2 — open the link on the phone

1. Open the link (or scan the QR code with the Camera app) **on the phone you want to test on**, in
   Safari.
2. Tap **Register** / **Download profile**, then **Allow** when iOS asks to download a
   configuration profile.
3. Go to **Settings** → **Profile Downloaded** (near the top; on older iOS versions it is under
   **General** → **VPN & Device Management**) → **Install** → enter your passcode → **Install**.
4. Safari shows a confirmation page. Done — the profile has told Apple which phone this is.

The link works for eight minutes after it was produced and for one phone at a time. If it has
expired, ask for a new one.

## Step 3 — tell the engineer

Say "done" (or, if they used the expo.dev workflow, they will see your phone appear and approve
it). Your phone is now on the list, but **you cannot install the app until the next staging build
has been made** — that is on the engineer, see below. They will tell you when it is ready and how
to install it (T5.6).

## Android

Nothing to do. Android staging / UAT builds are plain `.apk` files; open the install link the
engineer gives you, allow installs from that source when Android asks, and install.

---

## For engineers

### What just happened

`eas device:create` → Website (or the `apple-device-registration-request` job in
`.eas/workflows/register-device.yml`) serves an iOS configuration profile that reports the phone's
UDID back to EAS, which registers it on the Apple team. The account may have more than one Apple
team — the CLI asks which; the workflow takes it as the `apple_team_id` input — so always register
on the team that owns `com.seandillon.expoboilerplate*` (`docs/environments-and-secrets.md` →
iOS runbook). Neither path needs the tester's UDID typed by hand; `bun run devices:add` → **Input**
is the escape hatch when you already have it.

You can answer **no** to the Apple-login prompt in `devices:add` and type the Team ID instead; the
workflow needs the App Store Connect API key on EAS (iOS runbook step 5) and no Apple login.

`bun run devices:list` shows what is registered (`--apple-team-id <id>` when the account has
several teams, or when running non-interactively).

### After a device is registered: rebuild

Ad hoc provisioning profiles bake in the UDID list, so a registered device is invisible to every
existing build. The next iOS build for an internal profile (`development`, `staging`, `uat`) must
be made with a **refreshed** profile:

- EAS Workflows (E4 / E5): the `build` job takes `refresh_ad_hoc_provisioning_profile: true`; the
  staging build in `deploy-staging` sets it so a merge to `main` after registration is enough.
- CLI: `bun run eas build -p ios --profile staging` prompts to add the new device to the profile
  when run interactively; with `--non-interactive` it reuses the old profile, so either run
  `bun run eas credentials -p ios` → profile → **Build Credentials** → **Provisioning Profile:
  Add or remove devices** first, or pass the workflow flag above.

An OTA update (`eas update`) is _not_ enough — the profile lives in the native binary.

### Limits and removal

- Apple allows **100 devices per class (iPhone, iPad, Mac) per team per membership year**, and a
  removed device keeps its slot until the yearly reset. Register real testers only, not every
  simulator-adjacent phone in the office.
- Remove a device: `bun run eas device:delete` (interactive pick, or `--udid <udid>`
  `--apple-team-id <id>`). It is disabled on EAS and can optionally be removed from the Apple
  Developer Portal in the same command; either way, rebuild afterwards to drop it from the profile.
- The `register-device` workflow pauses in **action required** until someone approves or rejects
  the enrolment on the run page; a rejected or abandoned run registers nothing.

### Where things live

| What                             | Where                                            |
| -------------------------------- | ------------------------------------------------ |
| CLI wrapper                      | `scripts/devices-add.js` (`bun run devices:add`) |
| Workflow                         | `.eas/workflows/register-device.yml`             |
| Credentials status / iOS runbook | `docs/environments-and-secrets.md` → Credentials |
| Install one-pager, Slack, Orbit  | T5.6 / #45 (not written yet)                     |
