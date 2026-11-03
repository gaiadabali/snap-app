import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/actions', () => ({ devBypassSignInAction: vi.fn(), requestMagicLinkAction: vi.fn() }));

import { AuthMethods } from './AuthMethods';

const html = (props: Partial<Parameters<typeof AuthMethods>[0]> = {}) =>
  renderToStaticMarkup(
    <AuthMethods mode="sign-in" returnTo="/app/receipts" yourtalEnabled {...props} />,
  );

describe('AuthMethods: "Sign in again" after staff_reauth_required', () => {
  it('offers a link that restarts YourTal sign-in as fresh, keeping returnTo', () => {
    const markup = html({ signInAgain: true });
    expect(markup).toContain('Sign in again');
    expect(markup).toContain('href="/auth/yourtal?fresh=1&amp;returnTo=%2Fapp%2Freceipts"');
  });

  it('is absent for an ordinary sign-in page, and the ordinary button never asks for fresh', () => {
    const markup = html();
    expect(markup).not.toContain('Sign in again');
    expect(markup).toContain('href="/auth/yourtal?returnTo=%2Fapp%2Freceipts"');
    expect(markup).not.toContain('fresh=1');
  });

  it('is absent when YourTal sign-in is off', () => {
    expect(html({ signInAgain: true, yourtalEnabled: false })).not.toContain('Sign in again');
  });
});
