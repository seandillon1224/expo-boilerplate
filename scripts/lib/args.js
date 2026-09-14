'use strict';
/**
 * One command-line parser for every script in `scripts/` (T11.1), wrapping
 * `util.parseArgs({ strict: true })` with a per-script option table.
 *
 * Why one: hand-rolled parsers drifted apart — `--flag=value` worked in some and not others, one
 * of them swallowed the next positional as a value, `-h` was hit and miss, and the same exit code
 * meant three different things. Everything below is the single answer to all of that.
 *
 * ## Exit-code convention
 *
 * Every script exposes `function main(argv) { … return code }` and ends with
 * `process.exitCode = main(process.argv.slice(2))` — never `process.exit()`, which can drop piped
 * stdout that has not flushed (Bun substitutes itself for node in `bun run`).
 *
 *   0  the script did its job and what it checks is fine (a skip with a notice counts as 0)
 *   1  what it checks failed, or it hit an error the operator must fix (over budget, a perf
 *      regression, a11y findings, a red Maestro run, a failed API call)
 *   2  usage / environment: the command line — or the environment the command line needs — must
 *      change before the script can do anything. An unknown flag, a missing or invalid value, no
 *      fingerprint-matched EAS build without `--build`, no `gh` login. Never "the check failed".
 *
 * ## Option table
 *
 *   parseArgs(argv, {
 *     name: 'bundle-budget',            // prefix for every diagnostic
 *     usage: 'Usage: …',                // string or () => string, printed by --help / -h
 *     options: {
 *       platform: { type: 'string', choices: ['web', 'ios', 'android'], required: true },
 *       days:     { type: 'number', integer: true, min: 1, default: 7 },
 *       strict:   { type: 'boolean' },                       // defaults to false
 *       only:     { type: 'string', multiple: true },        // repeatable
 *       'include-quarantine': { type: 'boolean', aliasFor: 'quarantine-only' },
 *     },
 *   })
 *   // → { values, positionals, help }
 *
 * `--flag value`, `--flag=value`, `-x value` and `--help` / `-h` work the same way everywhere.
 * Booleans are always present in `values` (never `undefined`); `type: 'number'` is validated and
 * coerced; `choices` / `required` / `integer` / `min` are checked here so no script repeats them.
 * Unknown flags, missing values and unexpected positionals throw `UsageError` (exit code 2).
 *
 * Plain Node built-ins only: the EAS `maestro` jobs run some of these scripts from a checkout
 * with no `node_modules`.
 */
const { parseArgs: nodeParseArgs } = require('node:util');

/** A bad command line (or an environment the command line cannot work in): exit 2. */
class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = 2;
  }
}

/** Anything else a script wants to report as a clean failure instead of a stack trace: exit 1. */
class ScriptError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = 'ScriptError';
    this.code = code;
  }
}

/** `node:util` error → the wording this repo uses, prefixed with the script name. */
function usageMessage(name, error) {
  const flag = /'(--?[^' ]+)/.exec(error.message)?.[1];
  switch (error.code) {
    case 'ERR_PARSE_ARGS_UNKNOWN_OPTION':
      return `${name}: unknown argument ${flag ?? error.message}`;
    case 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL':
      return `${name}: unexpected argument ${flag ?? /'([^']+)'/.exec(error.message)?.[1] ?? ''}`;
    case 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE':
      return /argument missing/.test(error.message)
        ? `${name}: ${flag} needs a value`
        : `${name}: ${flag} does not take a value`;
    default:
      return `${name}: ${error.message}`;
  }
}

function coerce(name, flag, option, raw) {
  if (option.type !== 'number') return raw;
  const value = Number(raw);
  if (!Number.isFinite(value) || (option.integer && !Number.isInteger(value))) {
    throw new UsageError(
      `${name}: --${flag} must be ${option.integer ? 'an integer' : 'a number'} (got \`${raw}\`)`,
    );
  }
  if (option.min !== undefined && value < option.min) {
    throw new UsageError(`${name}: --${flag} must be >= ${option.min} (got \`${raw}\`)`);
  }
  return value;
}

function check(name, flag, option, value) {
  if (option.choices && !option.choices.includes(value)) {
    throw new UsageError(
      `${name}: --${flag} must be one of ${option.choices.join('|')} (got \`${value}\`)`,
    );
  }
  return value;
}

/**
 * Parses `argv` (already sliced past `node script.js`) against the option table.
 * Returns `{ values, positionals, help }`; `help` is true when `--help` / `-h` was passed, and the
 * caller prints `usage` and returns 0.
 */
function parseArgs(argv, { name, usage, options = {}, allowPositionals = false } = {}) {
  const spec = { help: { type: 'boolean', short: 'h' } };
  for (const [flag, option] of Object.entries(options)) {
    spec[flag] = { type: option.type === 'boolean' ? 'boolean' : 'string' };
    if (option.short) spec[flag].short = option.short;
    if (option.multiple) spec[flag].multiple = true;
  }

  let parsed;
  try {
    parsed = nodeParseArgs({ args: argv, options: spec, strict: true, allowPositionals });
  } catch (error) {
    throw new UsageError(`${usageMessage(name, error)}. Try --help.`);
  }

  if (parsed.values.help) {
    if (usage) console.log(typeof usage === 'function' ? usage() : usage);
    return { values: { help: true }, positionals: [], help: true };
  }

  const values = {};
  for (const [flag, option] of Object.entries(options)) {
    const target = option.aliasFor ?? flag;
    let raw = parsed.values[flag];
    if (raw === undefined) {
      if (option.aliasFor) continue;
      if (option.required) throw new UsageError(`${name}: --${flag} is required. Try --help.`);
      values[target] = option.type === 'boolean' ? (option.default ?? false) : option.default;
      continue;
    }
    if (option.aliasFor && option.deprecated) console.warn(`${name}: ${option.deprecated}`);
    if (option.type === 'boolean') {
      values[target] = Array.isArray(raw) ? raw.length > 0 : raw;
      continue;
    }
    raw = Array.isArray(raw) ? raw : option.multiple ? [raw] : raw;
    values[target] = Array.isArray(raw)
      ? raw.map((one) => check(name, flag, option, coerce(name, flag, option, one)))
      : check(name, flag, option, coerce(name, flag, option, raw));
  }
  return { values, positionals: parsed.positionals, help: false };
}

/**
 * The one place a script's `main` is wired to the process: prints a `UsageError` / `ScriptError`
 * as a plain message with its code, anything else as a stack trace with code 1, and never calls
 * `process.exit()`. Handles an async `main` (init) as well as a sync one.
 */
function runMain(main, argv = process.argv.slice(2)) {
  const onError = (error) => {
    if (error instanceof UsageError || error instanceof ScriptError) {
      console.error(error.message);
      return error.code;
    }
    console.error(error?.stack ?? String(error));
    return 1;
  };
  try {
    const result = main(argv);
    if (result && typeof result.then === 'function') {
      result.then(
        (code) => {
          process.exitCode = code ?? 0;
        },
        (error) => {
          process.exitCode = onError(error);
        },
      );
      return;
    }
    process.exitCode = result ?? 0;
  } catch (error) {
    process.exitCode = onError(error);
  }
}

module.exports = { ScriptError, UsageError, parseArgs, runMain };
