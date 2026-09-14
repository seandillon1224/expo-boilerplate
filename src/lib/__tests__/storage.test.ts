import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { storage, storageDriver } from '@/lib/storage';

const KEY = 'test-key';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('storage.get', () => {
  it('returns null for a key that was never written', async () => {
    await expect(storage.get(KEY, z.boolean())).resolves.toBeNull();
  });

  it('round-trips a value through JSON and the schema', async () => {
    const schema = z.object({ tier: z.string(), seats: z.number() });
    await storage.set(KEY, { tier: 'pro', seats: 3 });

    expect(await AsyncStorage.getItem(KEY)).toBe('{"tier":"pro","seats":3}');
    await expect(storage.get(KEY, schema)).resolves.toEqual({ tier: 'pro', seats: 3 });
  });

  // Both are "written by a version of the app that is gone", and a caller that handles "not
  // stored yet" already handles them — so neither throws and neither needs a separate branch.
  it('reads a non-JSON value as absent', async () => {
    await AsyncStorage.setItem(KEY, 'not json at all');
    await expect(storage.get(KEY, z.boolean())).resolves.toBeNull();
  });

  it('reads a value that no longer matches its schema as absent', async () => {
    await storage.set(KEY, { tier: 'pro' });
    await expect(storage.get(KEY, z.boolean())).resolves.toBeNull();
  });

  // The distinction that matters: bad *data* is null, a broken *disk* is the caller's problem.
  it('rejects when the backend itself fails', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    await expect(storage.get(KEY, z.boolean())).rejects.toThrow('disk');
  });
});

describe('storage.set / storage.remove', () => {
  it('encodes primitives as JSON, so `false` is not confused with absent', async () => {
    await storage.set(KEY, false);
    expect(await AsyncStorage.getItem(KEY)).toBe('false');
    await expect(storage.get(KEY, z.boolean())).resolves.toBe(false);
  });

  it('removes a key', async () => {
    await storage.set(KEY, true);
    await storage.remove(KEY);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe('storageDriver', () => {
  // The TanStack Query persister serialises the cache itself and wants the raw string API.
  it('exposes the raw string get/set/remove the query persister needs', () => {
    expect(typeof storageDriver.getItem).toBe('function');
    expect(typeof storageDriver.setItem).toBe('function');
    expect(typeof storageDriver.removeItem).toBe('function');
  });
});
