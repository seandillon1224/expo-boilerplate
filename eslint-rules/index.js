// Local ESLint plugin: project-specific rules live in ./rules.
module.exports = {
  meta: { name: 'eslint-plugin-local' },
  rules: {
    'require-testid': require('./rules/require-testid'),
  },
};
