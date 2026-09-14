/**
 * `@/lib/env` runs its parse at import time, so every case here re-imports the module
 * inside `jest.isolateModules` with a different `process.env` / `__DEV__`. The schema
 * itself is covered by `env.schema.test.ts`; this file only pins the failure policy.
 */

// `__DEV__` is a Metro global; the tests flip it to exercise both branches.
const devGlobal = globalThis as unknown as { __DEV__: boolean };

function loadEnv(): typeof import('@/lib/env') {
  let mod: typeof import('@/lib/env') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/lib/env') as typeof import('@/lib/env');
  });
  if (!mod) throw new Error('module did not load');
  return mod;
}

describe('@/lib/env', () => {
  const originalDev = devGlobal.__DEV__;
  const originalApiUrl = process.env.EXPO_PUBLIC_API_URL;

  afterEach(() => {
    devGlobal.__DEV__ = originalDev;
    if (originalApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = originalApiUrl;
    jest.restoreAllMocks();
  });

  it('exposes the parsed environment when it is valid', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
    const { env, assertEnv } = loadEnv();
    expect(env.API_URL).toBe('https://example.test');
    expect(env.UPDATE_POLICY).toBe('silent');
    expect(assertEnv()).toBe(env);
  });

  it('throws at import time in development when the environment is invalid', () => {
    devGlobal.__DEV__ = true;
    process.env.EXPO_PUBLIC_API_URL = 'not-a-url';
    expect(() => loadEnv()).toThrow(/Invalid EXPO_PUBLIC_\* environment/);
  });

  it('logs and falls back to schema defaults in production', () => {
    devGlobal.__DEV__ = false;
    process.env.EXPO_PUBLIC_API_URL = 'not-a-url';
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { env } = loadEnv();

    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toMatch(/EXPO_PUBLIC_API_URL/);
    expect(message).toMatch(/Falling back to defaults/);
    expect(env.API_URL).toBe('https://jsonplaceholder.typicode.com');
  });
});
