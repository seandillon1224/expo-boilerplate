// Conventional Commits are required: release tooling (release-please, D1) derives
// versions and changelogs from them, and squash-merges use the PR title as the message.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
