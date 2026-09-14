// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');
const a11y = require('eslint-plugin-react-native-a11y');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');
const oxlint = require('eslint-plugin-oxlint');
const local = require('./eslint-rules');

// `eslint-config-expo/flat` only matches `**/*.ts` / `**/*.tsx`, so `.mts` / `.cts` files would be
// reported as "no matching configuration". Re-apply its TypeScript block to those extensions too,
// which is what lets the pre-commit glob cover every module flavour (`lefthook.yml`).
const expoTypeScript = expoConfig.find((entry) => entry.files?.includes('**/*.ts'));

module.exports = defineConfig([
  expoConfig,
  { ...expoTypeScript, name: 'expo/typescript/mts-cts', files: ['**/*.mts', '**/*.cts'] },
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
    files: ['scripts/**/*.{js,ts}', 'eslint-rules/**/*.js', '*.config.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        Bun: 'readonly',
      },
    },
  },
  // oxlint runs first in `bun run lint` (ADR-0004); turn off every rule it already reports so
  // ESLint only owns what oxlint cannot express. Placed after our rules block so the
  // `unused-imports/*` rules above (the `^_` policy) stay in effect.
  ...oxlint.buildFromOxlintConfigFile('.oxlintrc.json'),
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
