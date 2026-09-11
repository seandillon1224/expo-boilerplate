# Installing the staging app

For designers, PMs and testers. No terminal, no developer tools — just your phone and the release
Slack channel. Engineers: the mechanics are in [Build sharing](build-sharing.md).

**The staging app** is the latest version of `main`, updated every time an engineer merges. It is a
separate app from the store version (a different name and icon, so both can live on your phone).

## Where the links come from

Every merge posts one message in the release Slack channel (ask an engineer which channel; you
should be in it). It always starts with **Staging** and has an **iOS** line and an **Android**
line — each one is a link to that build's **install page**: a web page with a QR code and an
**Install** button. That page is the only thing you ever need. It works without an Expo account.

Most days the message says _JS-only change: installed staging apps pick it up on next launch_ —
you do nothing, the app you already have updates itself the next time you open it (close it fully
and open it again if you want the change right away).

## iPhone / iPad

**First time only — register your phone.** Apple only lets a test app run on phones the team has
listed. Follow [Getting the staging app on your iPhone](device-onboarding.md) (two minutes, one
link from an engineer, one profile to accept). Then **wait for the next staging build** — your
phone is not in any build made before you registered. The engineer will tell you when one exists
(they usually just merge something, or re-run the staging workflow with iOS builds enabled).

**Installing (every time a new build is needed):**

1. In Slack, open the latest **Staging** message and tap the **iOS** link — or, if the link is on
   someone else's screen, scan the QR code on the install page with your **Camera** app.
2. On the install page, tap **Install**. iOS asks _"expo.dev would like to install …"_ → **Install**.
3. Go to the home screen. The icon appears greyed out with _Installing…_ and then _Loading…_; give
   it a minute on slow Wi-Fi. Deleting the old copy first is not required — the new build replaces
   it.
4. **If iOS says "Untrusted Developer" or "Untrusted Enterprise Developer"** when you open the app:
   **Settings** → **General** → **VPN & Device Management** → tap the developer entry → **Trust**.
   Once per phone.
5. If the install page says _"This device is not registered"_ or the icon never finishes
   installing, your phone is not in this build: go back to **First time only** above, or ask for a
   newer build.

## Android

1. In Slack, open the latest **Staging** message and tap the **Android** link — or scan the QR
   code on the install page. Use Chrome (or the phone's default browser).
2. Tap **Install** on the page; the `.apk` file downloads. Open it from the download banner or
   from **Files** → **Downloads**.
3. The first time, Android says _"For your security, your phone is not allowed to install unknown
   apps from this source"_: tap **Settings**, switch on **Allow from this source** for the browser
   (or for Files), then go back and tap **Install** again. Once per phone per app that opens the
   file.
4. If Google Play Protect asks _"Install anyway?"_ → **Install anyway** (or **More details** →
   **Install anyway**). The app is not on the Play Store, which is what this warning means.
5. Installing over the existing staging app keeps it in place and keeps your data. If Android
   refuses with _"App not installed"_, uninstall the old staging app first and try again.

## "Why do I need to reinstall sometimes?"

Two kinds of change reach the staging app:

- **Most changes** (screens, text, logic, images) are delivered **over the air**: the app you have
  downloads them on its next launch. Nothing to install. The Slack message says _JS-only change_.
- **Some changes** touch the native part of the app — a new permission, a new device feature, a
  library upgrade, a new app icon. Those cannot be sent over the air, so the engineers' pipeline
  makes a **new build**, and the Slack message is flagged
  **⚠️ Reinstall required — the native fingerprint changed, new staging builds were cut. Installed
  apps will NOT receive this update.**

That last line is literal: an app you installed before that message **stays on the old version**,
even for later JS-only changes, until you install the new build from the link in that message (or
any later one). So the rule is:

| Slack says                               | You do                                                  |
| ---------------------------------------- | ------------------------------------------------------- |
| _JS-only change …_                       | Nothing. Reopen the app.                                |
| **⚠️ Reinstall required**                | Tap the iOS / Android link in that message and install. |
| _⏭️ no build for this fingerprint_ (iOS) | There is no iPhone build yet; ask an engineer.          |

"Fingerprint" is the pipeline's name for the exact native recipe of the app; when it changes, a
new build is the only way to get it onto your phone. Your account, settings and data inside the app
are kept across reinstalls on both platforms.

## Something else is wrong

- **The app opens but looks old** — close it completely (swipe it away in the app switcher) and
  open it again; the update downloads on launch and shows on the next one. Still old? Check the
  latest Slack message for a **Reinstall required** flag you may have missed.
- **The link is dead or asks me to log in** — you have probably opened a workflow-run link or a PR
  comment link, which are for engineers. Ask for the install page link (expo.dev → the build).
- **UAT builds** — same steps, from the **UAT** Slack message; on iOS your phone must be registered
  before that build was made, exactly like staging.
- **TestFlight / Play internal** builds are the store release candidates and come through the
  TestFlight app or the Play Store's internal-testing link instead; nothing on this page applies to
  them. An engineer adds you to the tester list on the store side.
