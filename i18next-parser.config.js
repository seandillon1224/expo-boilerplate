/** @type {import('i18next-parser').UserConfig} */
module.exports = {
  // Only shipped source defines keys. Tests and Reassure perf tests render the same screens with
  // their own literal strings; scanning them would add keys no user ever sees and make
  // `bun run i18n:check` fail on a test-only string.
  input: ['src/**/*.{ts,tsx}', '!src/**/__tests__/**', '!src/__perf__/**'],
  output: 'src/i18n/locales/$LOCALE/$NAMESPACE.json',
  locales: ['en'],
  defaultNamespace: 'common',
  keySeparator: '.',
  namespaceSeparator: ':',
  sort: true,
  keepRemoved: false,
  createOldCatalogs: false,
  // Keys are the source of truth; the parser fills missing values with the key itself so an
  // untranslated string is obvious in the UI rather than silently blank.
  defaultValue: (locale, namespace, key) => key,
  lexers: {
    ts: ['JavascriptLexer'],
    tsx: ['JsxLexer'],
  },
};
