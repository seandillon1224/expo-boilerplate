import { envSchema, parseEnv, readRawEnv } from '@/lib/env.schema';

describe('envSchema', () => {
  it('applies defaults when nothing is provided', () => {
    const result = parseEnv({});
    expect(result).toEqual({
      success: true,
      env: {
        API_URL: 'https://jsonplaceholder.typicode.com',
        SENTRY_DSN: undefined,
        APP_VARIANT: undefined,
      },
    });
  });

  it('accepts a fully valid configuration', () => {
    const result = parseEnv({
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
      EXPO_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      EXPO_PUBLIC_APP_VARIANT: 'staging',
    });
    expect(result).toEqual({
      success: true,
      env: {
        API_URL: 'https://api.example.com',
        SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
        APP_VARIANT: 'staging',
      },
    });
  });

  it('treats empty strings as unset for optional keys', () => {
    const parsed = envSchema.parse({
      EXPO_PUBLIC_API_URL: '',
      EXPO_PUBLIC_SENTRY_DSN: '',
      EXPO_PUBLIC_APP_VARIANT: '  ',
    });
    expect(parsed.EXPO_PUBLIC_API_URL).toBe('https://jsonplaceholder.typicode.com');
    expect(parsed.EXPO_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(parsed.EXPO_PUBLIC_APP_VARIANT).toBeUndefined();
  });

  it('rejects an invalid API url and returns the defaults as fallback', () => {
    const result = parseEnv({ EXPO_PUBLIC_API_URL: 'not a url' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.issues.map((issue) => issue.key)).toEqual(['EXPO_PUBLIC_API_URL']);
    expect(result.fallback.API_URL).toBe('https://jsonplaceholder.typicode.com');
  });

  it('rejects a non-http(s) API url', () => {
    expect(envSchema.safeParse({ EXPO_PUBLIC_API_URL: 'ftp://example.com' }).success).toBe(false);
  });

  it('rejects an unknown app variant', () => {
    const result = parseEnv({ EXPO_PUBLIC_APP_VARIANT: 'qa' });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.issues[0]?.key).toBe('EXPO_PUBLIC_APP_VARIANT');
  });

  it('reads literal process.env keys', () => {
    expect(Object.keys(readRawEnv()).sort()).toEqual([
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_APP_VARIANT',
      'EXPO_PUBLIC_SENTRY_DSN',
    ]);
  });
});
