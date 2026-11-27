import { describe, expect, it } from 'vitest';

import { individualNavFor, mailListedIn } from '@/app/app/_shell/nav';
import { GOD_BRANDS, switcherTiles } from './god-brands';

const keys = (adultBrands: boolean) => switcherTiles({ adultBrands }).map((t) => t.key);

describe('switcherTiles', () => {
  it('an adult sees every brand, in the canonical order', () => {
    expect(keys(true)).toEqual(['yourtal', 'snapapp', 'ftr', 'spambank']);
  });

  it('hides Spambank (and any adults-only brand) when the adult signal is off', () => {
    expect(keys(false)).toEqual(['yourtal', 'snapapp', 'ftr']);
    for (const b of GOD_BRANDS.brands.filter((x) => x.adultsOnly)) expect(keys(false)).not.toContain(b.key);
  });

  it('marks the current app and does not link it', () => {
    const me = switcherTiles({ adultBrands: true }).find((t) => t.key === 'snapapp');
    expect(me).toMatchObject({ current: true, href: null, external: false });
    expect(switcherTiles({ adultBrands: true }).filter((t) => t.current)).toHaveLength(1);
  });

  it('links the others to their app URL, and Spambank to this app’s own Mail screen', () => {
    const byKey = Object.fromEntries(switcherTiles({ adultBrands: true }).map((t) => [t.key, t]));
    expect(byKey.yourtal).toMatchObject({ href: 'https://member.yourtal.gaiada.com', external: true });
    expect(byKey.ftr).toMatchObject({ href: 'https://freetaxreturns.com.au', external: true });
    expect(byKey.spambank).toMatchObject({ href: '/app/mail', external: false });
  });

  it('puts nothing about the person, and no tracking, in any link', () => {
    for (const t of switcherTiles({ adultBrands: true })) {
      expect(t.href ?? '').not.toMatch(/[?#]/);
    }
  });
});

describe('the adult signal is the Mail nav entry', () => {
  it('an adult with Mail offered is eligible; without it, a teen’s space and a failed read are not', () => {
    expect(mailListedIn(individualNavFor(true, false, true))).toBe(true);
    expect(mailListedIn(individualNavFor(true, false, false))).toBe(false);
    expect(mailListedIn(individualNavFor(true, true, true))).toBe(false);
  });

  it('a teen’s own space never gets the Spambank tile', () => {
    const teenNav = individualNavFor(true, true, true);
    expect(switcherTiles({ adultBrands: mailListedIn(teenNav) }).map((t) => t.key)).not.toContain('spambank');
  });
});
