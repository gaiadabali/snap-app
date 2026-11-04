import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { YourtalMovePromptView } from './YourtalMovePrompt';

describe('YourtalMovePromptView', () => {
  const markup = renderToStaticMarkup(<YourtalMovePromptView onDismiss={() => {}} />);

  it('says what to do and that the account is kept', () => {
    expect(markup).toContain('Sign in with YourTal to keep your account');
    expect(markup).toContain('Use the same email address as this account');
  });

  it('points at the existing /auth/yourtal flow and offers Not now', () => {
    expect(markup).toContain('href="/auth/yourtal?returnTo=/app&amp;move=1"');
    expect(markup).toContain('Not now');
  });

  it('says nothing about a mismatch until one happened, then names the account’s own email', () => {
    expect(markup).not.toContain('different email');
    const refused = renderToStaticMarkup(<YourtalMovePromptView onDismiss={() => {}} mismatchEmail="me@example.com" />);
    expect(refused).toContain(
      'Your YourTal account uses a different email. Use the YourTal account with me@example.com, or change your SnapApp email first.',
    );
  });
});
