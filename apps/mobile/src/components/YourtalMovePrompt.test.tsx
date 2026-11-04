import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('@/api', () => ({ api: vi.fn() }));

import { YourtalMovePromptView } from './YourtalMovePrompt';

const html = (over: Partial<Parameters<typeof YourtalMovePromptView>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(YourtalMovePromptView, { busy: false, error: null, onSignIn: () => {}, onDismiss: () => {}, ...over }),
  );

describe('YourtalMovePromptView', () => {
  it('says what to do and offers sign in and Not now', () => {
    const t = html();
    expect(t).toContain('Sign in with YourTal to keep your account');
    expect(t).toContain('Use the same email address as this account');
    expect(t).toContain('Sign in with YourTal');
    expect(t).toContain('Not now');
  });

  it('shows a refusal as a sentence', () => {
    expect(html({ error: 'YourTal isn’t answering right now.' })).toContain('YourTal isn’t answering right now.');
  });
});
