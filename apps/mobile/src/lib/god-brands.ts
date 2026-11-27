/**
 * The GOD brand list behind the "A GOD company" link and the app switcher sheet (god TASKS 9.13).
 *
 * `GOD_BRANDS` is a small copy of the canonical https://god.gaiada.com/brands.json, the same one
 * the web app keeps (`apps/web/src/lib/god-brands.ts`). It is NOT a vendored package:
 * `test/god-brands-drift.test.ts` compares both copies with a pinned copy of the file
 * (`test/fixtures/god-brands.json`) and fails CI on drift. To change a name or URL: edit
 * brands.json on god.gaiada.com first, re-pin the fixture, update both constants in one PR.
 *
 * Links carry no query string, no fragment and nothing about the person.
 */
export type GodBrandKey = 'yourtal' | 'snapapp' | 'ftr' | 'spambank';

export type GodBrand = {
  key: GodBrandKey;
  name: string;
  purpose: string;
  url: string;
  appUrl: string | null;
  /** Set when the brand lives inside this app instead of at `appUrl` (Spambank is this app's Mail screen). */
  inApp?: 'mail';
  adultsOnly: boolean;
};

export type GodBrandList = {
  version: number;
  god: { name: string; fullName: string; label: string; url: string };
  brands: GodBrand[];
};

export const GOD_BRANDS: GodBrandList = {
  version: 1,
  god: {
    name: 'GOD',
    fullName: 'Global Omni Data',
    label: 'A GOD company',
    url: 'https://god.gaiada.com',
  },
  brands: [
    {
      key: 'yourtal',
      name: 'YourTal',
      purpose: 'Watch, earn and spend locally',
      url: 'https://yourtal.gaiada.com',
      appUrl: 'https://yourtal.gaiada.com',
      adultsOnly: false,
    },
    {
      key: 'snapapp',
      name: 'SnapApps',
      purpose: 'Scan and keep every receipt',
      url: 'https://snapapp.gaiada.com',
      appUrl: 'https://app.snapapps.gaiada.com',
      adultsOnly: false,
    },
    {
      key: 'ftr',
      name: 'Free Tax Returns',
      purpose: 'Your free deduction worksheet',
      url: 'https://freetaxreturns.com.au',
      appUrl: 'https://freetaxreturns.com.au',
      adultsOnly: false,
    },
    {
      key: 'spambank',
      name: 'Spambank',
      purpose: 'A spam-free address for sign-ups',
      url: 'https://god.gaiada.com/brands/spambank/',
      appUrl: null,
      inApp: 'mail',
      adultsOnly: true,
    },
  ],
};

/** The brand this app is. Shown in the sheet, marked and not linked. */
export const CURRENT_BRAND: GodBrandKey = 'snapapp';

/** The Mail screen's route in this app (`src/app/mail`). */
export const MAIL_ROUTE = '/mail';

export type SwitcherTile = {
  key: GodBrandKey;
  name: string;
  purpose: string;
  /** An external site to open; null for the current app and for this app's own Mail screen. */
  url: string | null;
  /** An in-app route to push; null for everything else. */
  route: string | null;
  current: boolean;
};

/**
 * The tiles to show. `adultBrands` is the signal that already decides whether the Mail entry is
 * in the menu (`mailEntryListed`: mail offered by the server, not a teen's space). A teen, an
 * account that is not eligible and a failed read all leave it false, so every adults-only brand
 * is hidden. Cosmetic only: the server refuses Mail to anyone not allowed.
 */
export function switcherTiles(opts: { adultBrands: boolean }): SwitcherTile[] {
  const tiles: SwitcherTile[] = [];
  for (const b of GOD_BRANDS.brands) {
    if (b.adultsOnly && !opts.adultBrands) continue;
    const current = b.key === CURRENT_BRAND;
    const inApp = b.inApp === 'mail';
    if (!current && !inApp && !b.appUrl) continue;
    tiles.push({
      key: b.key,
      name: b.name,
      purpose: b.purpose,
      url: current || inApp ? null : b.appUrl,
      route: !current && inApp ? MAIL_ROUTE : null,
      current,
    });
  }
  return tiles;
}
