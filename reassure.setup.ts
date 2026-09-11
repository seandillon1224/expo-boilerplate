import { configure } from 'reassure';

// Reassure settings (PLAN.md decision 7). Reassure has no config file: it runs Jest with this
// repo's jest.config.js plus its own `--testMatch`, and `jest.setup.ts` loads this file only in
// that child process (it is marked by `REASSURE_OUTPUT_FILE`), so `bun run test` never imports
// reassure. Per-test overrides (`runs`, `warmupRuns`) are the second argument of
// `measureRenders` / `measureFunction`; see docs/perf-tests.md.
configure({
  // Measured runs per test. The CI job (`Perf (Reassure)` in .github/workflows/ci.yml) measures
  // base and head on the same runner, so 10 is enough for its statistical compare; raise it in a
  // test that `bun run perf:check` shows as unstable rather than globally.
  runs: 10,
  // Discarded runs before measuring: absorbs module loading, JIT and first-render caches.
  warmupRuns: 1,
  // Drop statistical outliers before comparing; keeps a single GC pause from failing the gate.
  removeOutliers: true,
  // Both testing libraries resolve under jest-expo; pin RNTL so auto-detection never warns.
  testingLibrary: 'react-native',
  // `outputFile` is left alone: the CLI sets it per run (.reassure/baseline.perf vs current.perf).
});
