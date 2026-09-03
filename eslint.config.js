// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');
const a11y = require('eslint-plugin-react-native-a11y');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');
const local = require('./eslint');

module.exports = defineConfig([
  expoConfig,
  {
    plugins: {
      // eslintrc-style plugin; only its rule set is reused under flat config.
      'react-native-a11y': a11y,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
      local,
    },
    rules: {
      'local/require-testid': 'error',
      ...a11y.configs.all.rules,
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,ts}', 'eslint/**/*.js', '*.config.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // Must be last so it disables every formatting rule Prettier owns.
  prettierConfig,
  {
    ignores: [
      'dist/*',
      'dist-*/*',
      'coverage/*',
      '.expo/*',
      'expo-env.d.ts',
      'node_modules/*',
      'ios/*',
      'android/*',
    ],
  },
]);
