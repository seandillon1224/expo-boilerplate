import { render, screen } from '@testing-library/react-native';
import { useTranslation } from 'react-i18next';

import i18n from '@/i18n';
import { Text } from '@/tw';

function Greeting() {
  const { t } = useTranslation();
  return <Text testID="i18n-greeting">{t('home.title')}</Text>;
}

describe('i18n', () => {
  it('falls back to en when the device locale has no bundled catalog', () => {
    // jest.setup mocks the device locale as `fr`; only `en` ships.
    expect(i18n.language).toBe('fr');
    expect(i18n.resolvedLanguage).toBe('en');
    expect(i18n.t('home.title')).toBe('Home');
  });

  it('renders a translated string through useTranslation', async () => {
    await render(<Greeting />);
    expect(screen.getByTestId('i18n-greeting')).toHaveTextContent('Home');
  });
});
