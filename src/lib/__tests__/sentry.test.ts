import * as Sentry from '@sentry/react-native';

const mockedInit = jest.mocked(Sentry.init);
const mockedCapture = jest.mocked(Sentry.captureException);

/** `@/lib/env` parses `process.env` at import time, so each case needs a fresh module graph. */
function loadSentry(dsn: string | undefined) {
  const previous = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  try {
    let mod!: typeof import('@/lib/sentry');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('@/lib/sentry');
    });
    return mod;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    else process.env.EXPO_PUBLIC_SENTRY_DSN = previous;
  }
}

describe('initSentry', () => {
  beforeEach(() => {
    mockedInit.mockClear();
    mockedCapture.mockClear();
  });

  it('is a no-op without a DSN', () => {
    const { initSentry } = loadSentry(undefined);
    expect(initSentry()).toBe(false);
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('initialises with tracing off when a DSN is set', () => {
    const { initSentry } = loadSentry('https://abc@o1.ingest.sentry.io/1');
    expect(initSentry()).toBe(true);
    expect(mockedInit).toHaveBeenCalledTimes(1);
    expect(mockedInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://abc@o1.ingest.sentry.io/1',
        environment: 'development',
        tracesSampleRate: 0,
        enableAutoPerformanceTracing: false,
        enableNativeFramesTracking: false,
      }),
    );
  });

  it('forwards handled errors to Sentry', () => {
    const { captureException } = loadSentry(undefined);
    const error = new Error('boom');
    captureException(error, { source: 'test' });
    expect(mockedCapture).toHaveBeenCalledWith(error, { extra: { source: 'test' } });
  });
});
