import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MobileNav } from './MobileNav';

describe('MobileNav', () => {
  const markup = renderToStaticMarkup(<MobileNav items={[{ href: '/app', label: 'Overview' }]} />);

  it('starts closed: a labelled disclosure button, no link list yet, hidden from md up', () => {
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="panel-mobile-nav"');
    expect(markup).toContain('aria-label="Open menu"');
    expect(markup).toContain('md:hidden');
    expect(markup).not.toContain('Overview');
  });
});
