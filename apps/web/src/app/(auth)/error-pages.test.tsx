import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_ERRORS } from '@/lib/auth/auth-errors';

/**
 * The pages that used to print `?error=` as text. They now render only
 * SnapApp's own wording for a known code, and nothing for anything else.
 */
vi.mock('@/lib/auth/yourtal', () => ({ isYourtalWebSignInAvailable: async () => false }));
vi.mock('@/lib/api/server', () => ({ api: vi.fn(async () => []), ApiError: class extends Error {} }));
vi.mock('@/lib/auth/session', () => ({ hasSessionCookie: async () => true }));

const EVIL = 'Your account is locked, call +61 400 000 000';
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

type Loader = () => Promise<{ default: unknown }>;

beforeEach(() => {
  vi.resetModules();
});

async function pageHtml(load: Loader, error?: string): Promise<string> {
  const { default: Page } = await load();
  const element = await (Page as (p: unknown) => Promise<ReactElement>)({
    searchParams: Promise.resolve(error === undefined ? {} : { error }),
  });
  return decode(renderToStaticMarkup(element));
}

const PAGES: Array<[string, Loader]> = [
  ['sign-in', () => import('./sign-in/page')],
  ['register', () => import('./register/page')],
  ['forgot-password', () => import('./forgot-password/page')],
  ['reset-password', () => import('./reset-password/page')],
  ['verify-email', () => import('./verify-email/page')],
  ['onboarding', () => import('./onboarding/page')],
];

describe.each(PAGES)('%s page', (_name, load) => {
  it('renders nothing of arbitrary text in ?error=', async () => {
    const html = await pageHtml(load, EVIL);
    expect(html).not.toContain('locked');
    expect(html).not.toContain('+61');
    expect(html).not.toContain('role="alert"');
  });

  it("renders SnapApp's own message for a known code", async () => {
    const html = await pageHtml(load, 'link_invalid');
    expect(html).toContain(AUTH_ERRORS.link_invalid.message);
  });
});

describe('sign-in and register: every known code', () => {
  for (const [name, load] of PAGES.slice(0, 2)) {
    it.each(Object.entries(AUTH_ERRORS))(`${name}: %s shows its message`, async (code, entry) => {
      const html = await pageHtml(load, code);
      expect(html).toContain(entry.message);
    });
  }

  it('shows a YourTal cancel as a quiet note, not a red alert', async () => {
    const html = await pageHtml(PAGES[0]![1], 'yourtal_cancelled');
    expect(html).toContain('auth-note');
    expect(html).not.toContain('auth-alert-error');
  });

  it('shows a refusal as an alert', async () => {
    const html = await pageHtml(PAGES[0]![1], 'teen_invite_required');
    expect(html).toContain('auth-alert-error');
  });
});
