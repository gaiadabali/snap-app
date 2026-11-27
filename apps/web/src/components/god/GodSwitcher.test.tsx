import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { switcherTiles } from '@/lib/god-brands';
import { GodSwitcher } from './GodSwitcher';
import { GodSwitcherPanel } from './GodSwitcherPanel';

const panel = (adultBrands: boolean) => renderToStaticMarkup(<GodSwitcherPanel tiles={switcherTiles({ adultBrands })} />);

describe('GodSwitcher (the header button)', () => {
  const markup = renderToStaticMarkup(<GodSwitcher adultBrands />);

  it('is a real, labelled button that starts closed, with a 44 px target and no panel', () => {
    expect(markup).toMatch(/^<div[^>]*><button type="button"/);
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="god-switcher-panel"');
    expect(markup).toContain('aria-label="GOD apps"');
    expect(markup).toContain('size-11');
    expect(markup).not.toContain('YourTal');
  });
});

describe('GodSwitcherPanel', () => {
  it('lists the brands with a name and purpose each, as plain links without a query string', () => {
    const m = panel(true);
    expect(m).toContain('role="dialog"');
    expect(m).toContain('aria-label="GOD apps"');
    expect(m).toContain('href="https://member.yourtal.gaiada.com"');
    expect(m).toContain('href="https://freetaxreturns.com.au"');
    expect(m).toContain('Watch, earn and spend locally');
    expect(m).toContain('Your free deduction worksheet');
    expect(m).not.toMatch(/href="[^"]*[?#][^"]*"/);
  });

  it('marks SnapApps as the current app, not linked', () => {
    const m = panel(true);
    expect(m).toContain('aria-current="true"');
    expect(m).toContain('You are here');
    expect(m).not.toContain('app.snapapps.gaiada.com');
  });

  it('sends Spambank to this app’s Mail screen for an adult, and hides it otherwise', () => {
    expect(panel(true)).toContain('href="/app/mail"');
    expect(panel(true)).toContain('Spambank');
    const teen = panel(false);
    expect(teen).not.toContain('Spambank');
    expect(teen).not.toContain('/app/mail');
  });

  it('ends with the GOD link in the footer, and every tile is at least 44 px tall', () => {
    const m = panel(true);
    expect(m).toContain('href="https://god.gaiada.com"');
    expect(m).toContain('A GOD company');
    expect((m.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('uses theme variables only, so light and dark both work', () => {
    expect(panel(true)).not.toMatch(/#[0-9a-f]{3,6}\b|style="[^"]*color/i);
  });
});
