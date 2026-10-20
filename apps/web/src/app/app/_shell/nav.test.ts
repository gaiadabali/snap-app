import { describe, expect, it } from 'vitest';

import { INDIVIDUAL_NAV, POINTS_HREF, individualNavFor } from './nav';

describe('individualNavFor', () => {
  it('lists the YourTal points entry while the link is on', () => {
    expect(individualNavFor(true)).toBe(INDIVIDUAL_NAV);
    expect(individualNavFor(true).some((i) => i.href === POINTS_HREF && i.label === 'YourTal points')).toBe(true);
  });

  it('drops only that entry when the link is off', () => {
    const nav = individualNavFor(false);
    expect(nav.some((i) => i.href === POINTS_HREF)).toBe(false);
    expect(nav).toHaveLength(INDIVIDUAL_NAV.length - 1);
  });
});
