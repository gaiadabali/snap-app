import { describe, expect, it } from 'vitest';

import { INDIVIDUAL_NAV, MAIL_HREF, POINTS_HREF, individualNavFor } from './nav';

describe('individualNavFor', () => {
  it('lists the YourTal points entry while the link is on', () => {
    expect(individualNavFor(true)).toBe(INDIVIDUAL_NAV);
    expect(individualNavFor(true).some((i) => i.href === POINTS_HREF && i.label === 'YourTal points')).toBe(true);
  });

  it('drops plan, credits and points in a teen’s own space, and keeps Family', () => {
    const hrefs = individualNavFor(true, true).map((i) => i.href);
    expect(hrefs).not.toContain('/app/plan');
    expect(hrefs).not.toContain('/app/credits');
    expect(hrefs).not.toContain(POINTS_HREF);
    expect(hrefs).toContain('/app/family');
  });

  it('drops only that entry when the link is off', () => {
    const nav = individualNavFor(false);
    expect(nav.some((i) => i.href === POINTS_HREF)).toBe(false);
    expect(nav).toHaveLength(INDIVIDUAL_NAV.length - 1);
  });

  it('has no Mail entry unless the server offers mail', () => {
    expect(individualNavFor(true, false, false).some((i) => i.href === MAIL_HREF)).toBe(false);
    expect(individualNavFor(false).some((i) => i.href === MAIL_HREF)).toBe(false);
  });

  it('puts Mail after Documents, with the unread badge, and changes nothing else', () => {
    const nav = individualNavFor(true, false, true);
    const hrefs = nav.map((i) => i.href);
    expect(hrefs.indexOf(MAIL_HREF)).toBe(hrefs.indexOf('/app/documents') + 1);
    expect(nav.find((i) => i.href === MAIL_HREF)).toEqual({ href: '/app/mail', label: 'Mail', badge: 'mail' });
    expect(nav.filter((i) => i.href !== MAIL_HREF)).toEqual(INDIVIDUAL_NAV);
  });

  it('keeps Mail out of a teen’s own space even when offered (mail is adults-only)', () => {
    expect(individualNavFor(true, true, true).some((i) => i.href === MAIL_HREF)).toBe(false);
  });

  it('combines with the YourTal switch being off', () => {
    const nav = individualNavFor(false, false, true);
    expect(nav.some((i) => i.href === POINTS_HREF)).toBe(false);
    expect(nav.some((i) => i.href === MAIL_HREF)).toBe(true);
  });
});
