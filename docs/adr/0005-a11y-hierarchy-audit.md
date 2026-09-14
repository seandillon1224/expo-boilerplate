# ADR-0005: Accessibility E2E as a hierarchy audit, not a screen-reader flow

- **Status:** Accepted
- **Date:** 2026-09-13
- **Issue:** #65 (D6 a11y Maestro flow; grilled 2026-09-13, the spec is the implementation brief)

## Context

PLAN.md D6 asked for "a Maestro flow with the screen reader enabled". Maestro 2.10.0 (pinned in
`ci.yml`, `e2e.yml` and the local scripts) cannot switch VoiceOver or TalkBack on and has no
accessibility-audit command. TalkBack would also change gesture semantics (double-tap to activate)
and break every existing flow, and `maestro test` writes hierarchy JSON only for failing steps, so
nothing about the accessibility tree can be checked from inside a normal run. ESLint already runs
the react-native-a11y rules (static layer); what was missing is a runtime check of what a screen
reader would actually read.

## Decision

D6 is redefined as a **screen-reader-output audit of Maestro's accessibility tree**:
`scripts/a11y-audit.js` (`bun run e2e:a11y`, Node built-ins only) drives the app to each screen
with a landing subflow in `.maestro/subflows/a11y/<screen>.yaml`, dumps `maestro hierarchy`, and
checks every **interactive** element — literal `testID`s on the elements
`eslint-rules/rules/require-testid.js` enforces, derived from `src/**/*.tsx` so there is no second
list to maintain — against three rules: a non-empty label (`accessibilityText`, else `text`, else
`title`), a label that is not the raw testID, and no duplicate labels on one screen. Dynamic
testIDs are listed as unaudited. Native only. It runs locally after `bun run e2e:<p> --keep`
(exit 1 on findings) and as an informational `after_maestro_tests` hook in `.eas/workflows/e2e.yml`
(`--no-fail`, uploaded as **A11y audit (\<p>)**).

## Consequences

- A leaked testID, an unlabeled pressable or two same-named buttons on a screen are caught on a
  real build, on both platforms, without anyone turning a screen reader on.
- Adding a screen to the audit is one landing subflow plus one line in the script's manifest.
- The EAS hook is informational: whether `maestro` and the device are still reachable from a hook
  is unverified, so the script skips with a notice rather than failing the job. Flip it to gating
  (drop `--no-fail`) after the first green run shows real reports in the artifact.
- PLAN.md D6 and the README's "not yet" list are reworded to match; the local reproduce runbook in
  `docs/native-e2e.md` gains a row.

### Rejected

- **Pure Maestro `text:` assertions per screen** — selects by i18n copy, which every other flow is
  forbidden to do, and drifts with every string change.
- **RNTL-only (`toHaveAccessibleName`)** — no runtime tree: it checks props, not what the platform
  merged and exposed.
- **An explicit manifest of interactive ids** — a second list that goes stale; the lint rule's
  element set already defines "interactive".
- **A web lane** — deferred: `maestro hierarchy` against Chromium is untested and axe-style tools
  cover the DOM better.
- **A gating hook from day one** — unproven infra inside the maestro job.

### Follow-ups

- Flip the hook to gating after a green run; consider a web lane with axe.
- Touch-target size from `bounds` (44 × 44 pt / 48 × 48 dp).
- A hint / `enabled` rule once a screen has an element that needs one.
