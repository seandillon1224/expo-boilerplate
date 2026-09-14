import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SignInScreen from '@/app/(auth)/sign-in';
import { resetSessionState, SESSION_STORAGE_KEY } from '@/features/session/use-session';

beforeEach(async () => {
  resetSessionState();
  await AsyncStorage.clear();
});

// @testing-library/react-native v14+: render/rerender/unmount are async.
describe('SignInScreen', () => {
  it('renders the demo copy and the sign-in button', async () => {
    await render(<SignInScreen />);
    expect(screen.getByTestId('sign-in-screen')).toBeOnTheScreen();
    expect(screen.getByText(/demo gate/)).toBeOnTheScreen();
    // Title and button share the wording, so the button is matched by its role.
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  it('signs in and persists the flag', async () => {
    await render(<SignInScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(await AsyncStorage.getItem(SESSION_STORAGE_KEY)).toBe('true');
  });
});
