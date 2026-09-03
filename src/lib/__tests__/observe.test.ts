import { Observe } from 'expo-observe';

const mockedConfigure = jest.mocked(Observe.configure);

/** `@/lib/env` parses `process.env` at import time, so each case needs a fresh module graph. */
function loadObserve(variant: string | undefined) {
  const previous = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (variant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
  else process.env.EXPO_PUBLIC_APP_VARIANT = variant;
  try {
    let mod!: typeof import('@/lib/observe');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('@/lib/observe');
    });
    return mod;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
    else process.env.EXPO_PUBLIC_APP_VARIANT = previous;
  }
}

describe('configureObserve', () => {
  beforeEach(() => mockedConfigure.mockClear());

  it('samples every install outside production and never dispatches from debug builds', () => {
    const { configureObserve } = loadObserve('staging');
    expect(configureObserve()).toEqual({
      environment: 'staging',
      dispatchInDebug: false,
      sampleRate: 1,
      integrations: { 'expo-router': true },
    });
  });

  it('samples a fraction of production installs', () => {
    const { configureObserve } = loadObserve('production');
    expect(configureObserve()).toMatchObject({ environment: 'production', sampleRate: 0.25 });
  });

  it('passes the config to Observe.configure with the router integration on', () => {
    const { configureObserve } = loadObserve(undefined);
    const applied = configureObserve();
    expect(mockedConfigure).toHaveBeenCalledTimes(1);
    expect(mockedConfigure).toHaveBeenCalledWith(applied);
    expect(applied).toMatchObject({ environment: 'development', sampleRate: 1 });
  });
});
