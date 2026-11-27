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

describe('AuthMethods: YourTal first on sign-in', () => {
  it('shows one "Continue with YourTal" button and folds SnapApp sign-in behind a link', () => {
    const markup = html();
    expect(markup).toContain('Continue with YourTal');
    expect(markup).not.toContain('Sign in with YourTal');
    expect(markup).toContain('One account for SnapApps, YourTal and our other apps.');
    expect(markup).toContain('Sign in with email instead');
    // Collapsed: a native <details> without the `open` attribute, holding Google.
    expect(markup).toMatch(/<details class="auth-more">/);
    expect(markup).toContain('Continue with Google');
  });

  it('falls back to the methods shown expanded, with no link, when YourTal is off', () => {
    const markup = html({ yourtalEnabled: false });
    expect(markup).not.toContain('Sign in with email instead');
    expect(markup).not.toContain('<details');
    expect(markup).not.toContain('YourTal');
    expect(markup).toContain('Continue with Google');
  });

  it('keeps "Create account with YourTal" on the register page', () => {
    const markup = html({ mode: 'register' });
    expect(markup).toContain('Create account with YourTal');
    expect(markup).not.toContain('Sign in with email instead');
  });
});
