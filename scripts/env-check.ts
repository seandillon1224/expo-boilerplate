#!/usr/bin/env bun
/**
 * Validates EXPO_PUBLIC_* variables against the app's Zod schema.
 *
 * Usage: `bun run env:check` (or `bun scripts/env-check.ts`).
 * Bun auto-loads `.env`, `.env.local`, and `.env.<NODE_ENV>` before this runs;
 * pass `--quiet` to print only failures. Exits 1 when any key is invalid.
 * All keys have defaults or are optional, so a missing `.env` passes.
 */
import { ENV_KEYS, envSchema, readRawEnv } from '../src/lib/env.schema';

const quiet = process.argv.includes('--quiet');
const raw = readRawEnv();
const result = envSchema.safeParse(raw);

const issuesByKey = new Map<string, string>();
if (!result.success) {
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.');
    if (!issuesByKey.has(key)) issuesByKey.set(key, issue.message);
  }
}

type Status = 'ok' | 'default' | 'unset' | 'invalid';

const rows = ENV_KEYS.map((key) => {
  const provided = raw[key] !== undefined && raw[key].trim() !== '';
  const issue = issuesByKey.get(key);
  let status: Status;
  if (issue) status = 'invalid';
  else if (provided) status = 'ok';
  else if (result.success && result.data[key] !== undefined) status = 'default';
  else status = 'unset';
  return { key, status, detail: issue ?? (status === 'ok' ? String(raw[key]) : '') };
});

const width = Math.max(...rows.map((row) => row.key.length));
const failed = rows.some((row) => row.status === 'invalid');

if (!quiet || failed) {
  for (const row of rows) {
    if (quiet && row.status !== 'invalid') continue;
    const mark = row.status === 'invalid' ? 'x' : row.status === 'ok' ? '+' : '-';
    console.log(`${mark} ${row.key.padEnd(width)}  ${row.status.padEnd(7)}  ${row.detail}`);
  }
}

if (failed) {
  console.error('\nenv-check failed. See .env.example for expected values.');
  process.exit(1);
}
if (!quiet) console.log('\nenv-check passed.');
