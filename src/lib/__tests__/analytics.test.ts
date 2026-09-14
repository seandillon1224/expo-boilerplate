import * as Sentry from '@sentry/react-native';
import { Observe } from 'expo-observe';

import { track } from '@/lib/analytics';

const mockedLogEvent = jest.mocked(Observe.logEvent);
const mockedBreadcrumb = jest.mocked(Sentry.addBreadcrumb);
const mockedInit = jest.mocked(Sentry.init);

/**
 * This suite runs in the state a bare checkout of the template ships in: `initSentry()` is never
 * called (no `EXPO_PUBLIC_SENTRY_DSN`) and there is no EAS project id, so both of `track()`'s
 * sinks are inert at runtime. That is the point — `track()` has no "is telemetry on?" branch,
 * because both SDKs already drop what they cannot send.
 */
describe('track', () => {
  beforeEach(() => {
    mockedLogEvent.mockClear();
    mockedBreadcrumb.mockClear();
  });

  it('logs the event to Observe and leaves a Sentry breadcrumb', () => {
    track('fetch_retried', { source: 'error-state', attempt: 2 });

    expect(mockedLogEvent).toHaveBeenCalledWith('fetch_retried', {
      attributes: { source: 'error-state', attempt: 2 },
    });
    expect(mockedBreadcrumb).toHaveBeenCalledWith({
      category: 'analytics',
      type: 'user',
      level: 'info',
      message: 'fetch_retried',
      data: { source: 'error-state', attempt: 2 },
    });
  });

  it('omits the options object entirely when there are no props', () => {
    track('app_opened');

    // `logEvent(name, undefined)` rather than `logEvent(name, { attributes: undefined })`: the
    // second form would write an empty attribute bag on every propless event.
    expect(mockedLogEvent).toHaveBeenCalledWith('app_opened', undefined);
    expect(mockedBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ data: undefined }));
  });

  it('is safe with Sentry uninitialised and Observe undispatched', () => {
    // No DSN in the test env, so nothing ever called `Sentry.init` — the no-op path.
    expect(mockedInit).not.toHaveBeenCalled();
    expect(() => track('fetch_retried', { source: 'error-state' })).not.toThrow();
    expect(mockedLogEvent).toHaveBeenCalledTimes(1);
    expect(mockedBreadcrumb).toHaveBeenCalledTimes(1);
  });
});
