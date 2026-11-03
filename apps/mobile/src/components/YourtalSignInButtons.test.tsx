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
