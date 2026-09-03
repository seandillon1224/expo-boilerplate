import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en/common.json';

const defaultNS = 'common';
const resources = { en: { common: en } } as const;

// Device language comes from the OS; anything without a bundled locale falls back to `en`.
const deviceLanguage = getLocales()[0]?.languageCode ?? undefined;

i18n.use(initReactI18next).init({
  compatibilityJSON: 'v4',
  resources,
  lng: deviceLanguage,
  fallbackLng: 'en',
  defaultNS,
  ns: [defaultNS],
  interpolation: { escapeValue: false },
});

export default i18n;
