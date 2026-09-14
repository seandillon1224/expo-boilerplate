/**
 * Key-value storage. The one place `@react-native-async-storage/async-storage` is imported, so
 * swapping the backend is a one-file change (T13.7).
 *
 * Two surfaces, because the app needs both:
 *
 * - `storage.get / set / remove` — typed, JSON-encoded values validated with a Zod schema on the
 *   way out. Everything the app itself persists goes through these.
 * - `storageDriver` — the raw string-level `{ getItem, setItem, removeItem }` object, for
 *   libraries that want to own the encoding themselves (the TanStack Query persister in
 *   `query-client.ts`).
 *
 * ## Swapping the backend
 *
 * `expo-sqlite/kv-store` is a drop-in replacement for AsyncStorage's async API (same method
 * names, plus synchronous `*Sync` variants) and is the better default once persisted data grows
 * beyond a few keys — AsyncStorage on Android is one 6 MB SQLite row by default. The swap is the
 * import line below and nothing else:
 *
 * ```ts
 * import AsyncStorage from 'expo-sqlite/kv-store';
 * ```
 *
 * Neither backend is a secret store. Tokens, keys and anything else that must not be readable
 * from a rooted device belong in `expo-secure-store`, which is a different module on purpose.
 *
 * ## Reads never throw on bad data
 *
 * A value that is absent, is not JSON, or does not match its schema all read as `null`: it was
 * written by a version of the app that is gone, and a caller that has to handle "not stored yet"
 * already handles "stored, but unreadable". Storage *failures* (a full or unavailable disk) do
 * reject — those are real and the caller decides what they mean.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ZodType } from 'zod';

/**
 * The raw string API, for libraries that bring their own serialisation.
 * Prefer `storage` below for anything the app persists itself.
 */
export const storageDriver = AsyncStorage;

async function get<T>(key: string, schema: ZodType<T>): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

async function set<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

async function remove(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

/** Typed key-value access. `get` returns `null` for absent, corrupt or off-schema values. */
export const storage = { get, set, remove };
