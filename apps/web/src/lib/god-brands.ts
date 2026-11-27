/**
 * The GOD brand list behind the "A GOD company" link and the app switcher (god TASKS 9.13).
 *
 * `GOD_BRANDS` is a small copy of the canonical https://god.gaiada.com/brands.json. It is NOT a
 * vendored package: `test/god-brands-drift.test.ts` compares it, and the phone app's copy
 * (`apps/mobile/src/lib/god-brands.ts`), with a pinned copy of the file (`test/fixtures/god-brands.json`)
 * and fails CI on drift. To change a name or URL: edit brands.json on god.gaiada.com first, then
 * re-pin the fixture and update both constants in the same PR.
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
      appUrl: 'https://member.yourtal.gaiada.com',
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
      url: 'https://spambank.gaiada.com',
      appUrl: null,
      inApp: 'mail',
      adultsOnly: true,
    },
  ],
};

/** The brand this app is. Shown in the switcher, marked and not linked. */
export const CURRENT_BRAND: GodBrandKey = 'snapapp';

/** Where the Mail screen lives in the web app. */
export const MAIL_HREF = '/app/mail';

/** Static marks, served from `public/god`. SnapApps uses the mark the site already ships. */
const ICONS: Record<GodBrandKey, string> = {
  yourtal: '/god/yourtal-mark.svg',
  snapapp: '/brand/snapapp-mark.svg',
  ftr: '/god/ftr-mark.svg',
  spambank: '/god/spambank-mark.svg',
};

export type SwitcherTile = {
  key: GodBrandKey;
  name: string;
  purpose: string;
  /** Where the tile goes; null for the current app, which is marked and not linked. */
  href: string | null;
  current: boolean;
  /** An external site, as opposed to this app's own Mail screen. */
  external: boolean;
  icon: string;
};

/**
 * The tiles to show. `adultBrands` is the signal that already decides whether the Spambank Mail
 * entry is in the nav (an adult, not impersonated, mail offered by the server). A teen, someone
 * who is not eligible, and a failed read all leave it false, so every adults-only brand is hidden.
 * Cosmetic only: Mail itself is refused by the server for anyone not allowed.
 */
export function switcherTiles(opts: { adultBrands: boolean }): SwitcherTile[] {
  const tiles: SwitcherTile[] = [];
  for (const b of GOD_BRANDS.brands as readonly GodBrand[]) {
    if (b.adultsOnly && !opts.adultBrands) continue;
    const current = b.key === CURRENT_BRAND;
    const inApp = b.inApp === 'mail';
    // A brand that lives in another app needs an app URL; with none and not in-app there is nowhere to go.
    if (!current && !inApp && !b.appUrl) continue;
    tiles.push({
      key: b.key,
      name: b.name,
      purpose: b.purpose,
      href: current ? null : inApp ? MAIL_HREF : b.appUrl,
      current,
      external: !current && !inApp,
      icon: ICONS[b.key],
    });
  }
  return tiles;
}

export type OtherBrand = { key: GodBrandKey; name: string; purpose: string; href: string; icon: string };

/**
 * The other GOD brands' public WEBSITES (the `url` field, not `appUrl`), for the "Part of GOD" home section.
 * Every brand except this one, in canonical order. Spambank is included: its website is public, and the card
 * only names it and says what it is.
 */
export function otherBrandSites(): OtherBrand[] {
  return (GOD_BRANDS.brands as readonly GodBrand[])
    .filter((b) => b.key !== CURRENT_BRAND)
    .map((b) => ({ key: b.key, name: b.name, purpose: b.purpose, href: b.url, icon: ICONS[b.key] }));
}
