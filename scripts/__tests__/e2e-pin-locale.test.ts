/* eslint-disable @typescript-eslint/no-require-imports -- plain-Node script under test; no @types/node */
const { DEFAULT_LOCALE, sameLanguage } = require('../e2e-pin-locale');

/**
 * The whole value of this script is *not* restarting the framework when it does not have to: a
 * `stop`/`start` costs ~20 s on every Android E2E run, and the emulator images the lane uses are
 * already English. `sameLanguage` is the check that decides, so the shapes a device can report a
 * locale in — BCP-47, the underscore form `getprop` sometimes returns, a bare language, nothing
 * at all — all have to land on the right side of it.
 */
describe('sameLanguage', () => {
  it.each([
    ['en-US', 'en-US'],
    ['en_US', 'en-US'],
    ['en-GB', 'en-US'],
    ['en', 'en-US'],
    ['EN-us', 'en-US'],
  ])('treats %s as already %s', (current: string, target: string) => {
    expect(sameLanguage(current, target)).toBe(true);
  });

  it.each([
    ['fr-FR', 'en-US'],
    ['ja-JP', 'en-US'],
    ['', 'en-US'],
  ])('treats %s as needing a change to %s', (current: string, target: string) => {
    expect(sameLanguage(current, target)).toBe(false);
  });

  // The pinned locale and the `TAB_LABEL` values in .maestro/subflows/steps/*.yaml are written
  // from the same catalog; `src/i18n/locales/en` is the one the template ships.
  it('pins the locale whose catalog the flows spell their labels from', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
  });
});
