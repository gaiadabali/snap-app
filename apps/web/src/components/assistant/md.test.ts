import { describe, expect, it } from 'vitest';

import { safeHref } from './md';

/**
 * Link targets in Snapper's answers. The href must always be one of the fixed
 * site paths or the support address — never the text it was matched from.
 */
describe('safeHref', () => {
  it('allows the site pages and returns the constant, not the input', () => {
    expect(safeHref('/pricing')).toEqual({ href: '/pricing', external: false });
    expect(safeHref(' /download/ ')).toEqual({ href: '/download', external: false });
    expect(safeHref('/pricing#practice')).toEqual({ href: '/pricing', external: false });
    expect(safeHref('/')).toEqual({ href: '/', external: false });
  });

  it('allows the support address only', () => {
    expect(safeHref('mailto:support@snapapps.com.au')?.href).toBe('mailto:support@snapapps.com.au');
    expect(safeHref('mailto:someone@else.com')).toBeNull();
  });

  it('refuses everything else', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example/pricing',
      '/\evil.example',
      'https://evil.example',
      '/admin',
      '/app/receipts',
      '/pricing/../admin',
      '',
    ]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});
