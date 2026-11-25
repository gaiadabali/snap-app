import { describe, expect, it, vi } from 'vitest';

import { handBackAuthReturn } from './auth-return';

describe('handBackAuthReturn (the PWA return page)', () => {
  it('does nothing, and never touches the browser session, on any other page', () => {
    const complete = vi.fn(() => ({ type: 'success' }));
    for (const pathname of ['/', '/receipts', '/oauth', '/oauth/yourtalx', '/auth/yourtal/callback']) {
      expect(handBackAuthReturn({ pathname, complete })).toBeNull();
    }
    expect(complete).not.toHaveBeenCalled();
  });

  it('hands the URL back when a sign-in is waiting', () => {
    const complete = vi.fn(() => ({ type: 'success' }));
    expect(handBackAuthReturn({ pathname: '/oauth/yourtal', complete })).toBe('handed-back');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('says nothing is waiting when no sign-in started here or the page is not the expected redirect', () => {
    expect(handBackAuthReturn({ pathname: '/oauth/yourtal', complete: () => ({ type: 'failed' }) })).toBe(
      'nothing-waiting',
    );
  });

  it('survives a missing opener (the opening tab was reloaded)', () => {
    const complete = () => {
      throw new Error('ERR_WEB_BROWSER_REDIRECT');
    };
    expect(handBackAuthReturn({ pathname: '/oauth/yourtal/', complete })).toBe('nothing-waiting');
  });
});
