import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import SignInScreen from '@/app/(auth)/sign-in';
import { resetSessionState, SESSION_STORAGE_KEY } from '@/features/session/use-session';
import { Text, View } from '@/tw';

// The real root layout, guard and all. `(tabs)` is stubbed with a single screen: this is a test of
// `<Stack.Protected>`, not of NativeTabs.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rootLayout = () => require('@/app/_layout');

function TabsHome() {
  return (
    <View testID="home-screen">
      <Text>Home</Text>
    </View>
  );
}

function renderApp() {
  return renderRouter(
    {
      _layout: rootLayout(),
      '(tabs)/index': TabsHome,
      '(auth)/sign-in': SignInScreen,
    },
    { initialUrl: '/' },
  );
}

beforeEach(async () => {
  resetSessionState();
  await AsyncStorage.clear();
});

describe('session guard', () => {
  it('sends a signed-out launch to the sign-in screen', async () => {
    await renderApp();
    expect(await screen.findByTestId('sign-in-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('opens straight on the app when the persisted flag says signed in', async () => {
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, 'true');
    await renderApp();
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    // Never a flash of the sign-in screen: the layout renders nothing until the flag is read.
    expect(screen.queryByTestId('sign-in-screen')).toBeNull();
  });

  it('lets the sign-in button through the guard', async () => {
    await renderApp();
    await screen.findByTestId('sign-in-screen');
    await act(async () => {
      fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('sign-in-screen')).toBeNull();
  });
});
