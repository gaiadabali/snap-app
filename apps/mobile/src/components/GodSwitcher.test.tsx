import type { MailStatus } from '@snap/api-contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { switcherTiles } from '@/lib/god-brands';
import { mailEntryListed } from '@/lib/mail-gate';

import { GodAboutCard, GodSwitcherContent } from './GodSwitcher';

const noop = () => {};

function html(adultBrands: boolean): string {
  return renderToStaticMarkup(
    createElement(GodSwitcherContent, { adultBrands, onOpenUrl: noop, onOpenRoute: noop, onClose: noop }),
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

describe('GodSwitcherContent', () => {
  it('lists every brand for an adult, with what each is for, and the GOD link', () => {
    const t = text(html(true));
    for (const s of ['GOD apps', 'YourTal', 'Watch, earn and spend locally', 'SnapApps', 'Free Tax Returns', 'Your free deduction worksheet', 'Spambank', 'A GOD company']) {
      expect(t).toContain(s);
    }
  });

  it('marks this app as the current one, as a labelled non-link', () => {
    const m = html(true);
    expect(text(m)).toContain('You are here');
    expect(m).toContain('aria-label="SnapApps, Scan and keep every receipt. You are here."');
    expect(m).not.toContain('app.snapapps.gaiada.com');
  });

  it('labels the external links, and gives the close button a name', () => {
    const m = html(true);
    expect(m).toContain('aria-label="YourTal, Watch, earn and spend locally. Opens in your browser."');
    expect(m).toContain('aria-label="Free Tax Returns, Your free deduction worksheet. Opens in your browser."');
    expect(m).toContain('aria-label="A GOD company. About GOD. Opens in your browser."');
    expect(m).toContain('aria-label="Close"');
  });

  it('hides Spambank when the adult signal is off (a teen, an ineligible account, a failed read)', () => {
    const t = text(html(false));
    expect(t).not.toContain('Spambank');
    expect(t).toContain('YourTal');
    expect(t).toContain('Free Tax Returns');
  });
});

describe('the adult signal is the one that lists Mail in the menu', () => {
  const status = {
    available: true,
    linked: true,
    mailbox: { state: 'on', address: 'a@b.c' },
    settings: { statements: false, workspaceId: null, alerts: true },
  } as unknown as MailStatus;

  it('an adult with mail offered gets Spambank; a teen space and a failed read do not', () => {
    const tiles = (listed: boolean) => switcherTiles({ adultBrands: listed }).map((t) => t.key);
    expect(tiles(mailEntryListed(status, null))).toContain('spambank');
    expect(tiles(mailEntryListed(status, 'teen'))).not.toContain('spambank');
    expect(tiles(mailEntryListed(null, null))).not.toContain('spambank');
  });

  it('Spambank opens this app\'s own Mail screen, never a URL', () => {
    const t = switcherTiles({ adultBrands: true }).find((x) => x.key === 'spambank');
    expect(t).toMatchObject({ url: null, route: '/mail', current: false });
  });

  it('no link carries a query string or a fragment', () => {
    for (const t of switcherTiles({ adultBrands: true })) expect(t.url ?? '').not.toMatch(/[?#]/);
  });
});

describe('GodAboutCard (Settings)', () => {
  const m = renderToStaticMarkup(createElement(GodAboutCard, { onOpenSwitcher: noop, onOpenGod: noop }));

  it('says SnapApps is part of GOD, links to god.gaiada.com and opens the sheet', () => {
    const t = text(m);
    expect(t).toContain('SnapApps is part of GOD (Global Omni Data), with YourTal, Free Tax Returns and Spambank.');
    expect(t).toContain('A GOD company');
    expect(t).toContain('god.gaiada.com');
    expect(m).toContain('aria-label="GOD apps. Open the list."');
  });
});
