import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HomePartOfGod } from './part-of-god';

const html = renderToStaticMarkup(<HomePartOfGod />);
const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);

describe('HomePartOfGod', () => {
  it('says what GOD is and names the group', () => {
    expect(html).toContain('SnapApps is part of GOD (Global Omni Data)');
    expect(html).toContain('YourTal, SnapApps, Free Tax Returns and Spambank');
  });

  it('links to the GOD site and the three other brand websites, and nothing else', () => {
    const hrefs = anchors.map((a) => /href="([^"]*)"/.exec(a)?.[1]);
    expect(hrefs).toEqual([
      'https://god.gaiada.com',
      'https://yourtal.gaiada.com',
      'https://freetaxreturns.com.au',
      'https://spambank.gaiada.com',
    ]);
  });

  it('opens each in a new tab with noopener, an accessible name, no query string or fragment', () => {
    expect(anchors).toHaveLength(4);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toMatch(/rel="[^"]*noopener[^"]*"/);
      expect(a).toMatch(/aria-label="[^"]+"/);
      expect(a).not.toMatch(/href="[^"]*[?#][^"]*"/);
    }
  });

  it('shows name, purpose and mark for the others, and not SnapApps itself as a card', () => {
    for (const t of ['YourTal', 'Free Tax Returns', 'Spambank', 'Watch, earn and spend locally', 'Your free deduction worksheet', 'A spam-free address for sign-ups'])
      expect(html).toContain(t);
    expect(html).toContain('/god/yourtal-mark.svg');
    expect(html).toContain('/god/ftr-mark.svg');
    expect(html).toContain('/god/spambank-mark.svg');
    expect(html).not.toContain('snapapps.gaiada.com');
    expect(html).not.toContain('Scan and keep every receipt');
  });
});
