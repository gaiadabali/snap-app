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
    expect(markup).toContain('href="/auth/yourtal?returnTo=/app"');
    expect(markup).toContain('Not now');
  });
});
