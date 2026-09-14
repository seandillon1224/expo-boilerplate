/**
 * Product analytics. One function, two sinks, no new vendor (T13.7).
 *
 * `track()` writes the event to both telemetry systems the template already has:
 *
 * - **EAS Observe** (`Observe.logEvent`) — the event itself. It lands on the current session
 *   alongside the launch / TTR / TTI metrics, so "what did the user do" and "how did the app
 *   behave" are queryable together (`eas observe:events`, see docs/observe.md).
 * - **Sentry** — the same event as a breadcrumb, so a crash report carries the last few things
 *   the user did before it. Breadcrumbs are not events; they cost nothing until something throws.
 *
 * Both sinks are no-ops in the states the template ships in, and `track()` does not check for
 * either: Observe dispatches only when `extra.eas.projectId` is set (and never from a debug
 * build), and `Sentry.addBreadcrumb` drops the crumb when no client was initialised — which is
 * every build without `EXPO_PUBLIC_SENTRY_DSN`. Calling `track()` in a bare checkout is
 * deliberately inert rather than an error.
 *
 * Screens never import an analytics vendor directly; they import `track` from here. Adding a
 * third sink (Amplitude, PostHog, a warehouse) is an edit to this file and nothing else.
 *
 * ## Naming
 *
 * `name` is a stable machine identifier in `snake_case`, past tense, `<object>_<verb>`
 * (`fetch_retried`, `update_applied`). It is the key you group by six months from now, so it
 * never carries a value — `fetch_retried` with `{ source: 'error-state' }`, never
 * `fetch_retried_from_error_state`. Props are attributes, not PII: no emails, no ids that
 * identify a person, no free-form user input.
 */
import { Observe } from 'expo-observe';

import { addBreadcrumb } from '@/lib/sentry';

/**
 * Event attributes. Observe preserves each value's type, so a count stays a number rather than
 * becoming the string `"5"` in a dashboard.
 */
export type TrackProps = Record<string, string | number | boolean>;

/** Record a product event. Safe to call from anywhere, at any time, in any build. */
export function track(name: string, props?: TrackProps): void {
  Observe.logEvent(name, props ? { attributes: props } : undefined);
  addBreadcrumb(name, props);
}
