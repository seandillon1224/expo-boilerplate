/** @type {import('i18next-parser').UserConfig} */
module.exports = {
  input: ['src/**/*.{ts,tsx}'],
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
