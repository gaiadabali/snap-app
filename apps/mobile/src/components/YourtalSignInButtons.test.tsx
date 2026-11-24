import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('@/api', () => ({ api: vi.fn() }));

import { YourtalSignInButtonsView } from './YourtalSignInButtons';

const html = (over: Partial<Parameters<typeof YourtalSignInButtonsView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(YourtalSignInButtonsView, { mode: 'both', busy: null, reauth: false, onGo: () => {}, ...over }),
  );

describe('YourtalSignInButtonsView', () => {
  it('shows only the ordinary buttons until staff are told to sign in again', () => {
    const t = html();
    expect(t).toContain('Sign in with YourTal');
    expect(t).toContain('Create account with YourTal');
    expect(t).not.toContain('Sign in again');
  });

  it('single mode shows one "Continue with YourTal" button and no create-account button', () => {
    const t = html({ mode: 'single' });
    expect(t).toContain('Continue with YourTal');
    expect(t).not.toContain('Sign in with YourTal');
    expect(t).not.toContain('Create account with YourTal');
  });

  it('single mode presses through to a sign-in, not a sign-up', () => {
    const onGo = vi.fn();
    const tree = YourtalSignInButtonsView({ mode: 'single', busy: null, reauth: false, onGo }) as unknown as {
      props: { children: Array<{ props?: { label?: string; onPress?: () => void } } | null> };
    };
    tree.props.children.find((c) => c?.props?.label === 'Continue with YourTal')!.props!.onPress!();
    expect(onGo).toHaveBeenCalledWith('signIn');
  });

  it('single mode still offers "Sign in again" after a staff refusal', () => {
    expect(html({ mode: 'single', reauth: true })).toContain('Sign in again');
  });

  it('signUp mode keeps only "Create account with YourTal"', () => {
    const t = html({ mode: 'signUp' });
    expect(t).toContain('Create account with YourTal');
    expect(t).not.toContain('Sign in with YourTal');
  });

  it('adds "Sign in again" after a staff_reauth_required refusal', () => {
    expect(html({ reauth: true })).toContain('Sign in again');
  });

  it('presses through to the fresh kind', () => {
    const onGo = vi.fn();
    const tree = YourtalSignInButtonsView({ mode: 'signIn', busy: null, reauth: true, onGo }) as unknown as {
      props: { children: Array<{ props?: { label?: string; onPress?: () => void } } | null> };
    };
    const again = tree.props.children.find((c) => c?.props?.label === 'Sign in again');
    again!.props!.onPress!();
    expect(onGo).toHaveBeenCalledWith('fresh');
  });
});
