// Bun-only install guard. npm/yarn/pnpm resolve a different dependency tree for
// Expo + React Native peers and produce a lockfile this repo does not track.
const ua = process.env.npm_config_user_agent || '';
if (!ua.startsWith('bun/')) {
  console.error('\nThis repo is Bun-only. Run: bun install\n');
  process.exit(1);
}
