import { screen } from '@testing-library/react-native';
import { measureRenders } from 'reassure';

import HomeScreen from '@/app/(tabs)/(home)/index';

// Seed Reassure perf test (PLAN.md decision 7). Run by `bun run perf`, not by `bun run test`:
// jest.config.js ignores `src/__perf__/`, and Reassure invokes Jest with its own testMatch.
// The Home screen is static (no data, no timers), so measurements stay deterministic.
describe('HomeScreen', () => {
  it('renders', async () => {
    await measureRenders(<HomeScreen />);
  });

  it('renders and is queryable', async () => {
    await measureRenders(<HomeScreen />, {
      scenario: async () => {
        await screen.findByTestId('home-screen');
      },
    });
  });
});
