import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DeleteAccountPanel, type DeleteAccountPanelProps } from './DeleteAccountPanel';

const noop = () => {};

function html(over: Partial<DeleteAccountPanelProps> = {}): string {
  return renderToStaticMarkup(
    createElement(DeleteAccountPanel, {
      yourtalLinked: false,
      typed: '',
      password: '',
      busy: false,
      error: null,
      onType: noop,
      onPassword: noop,
      onDelete: noop,
      ...over,
    }),
  );
}
const text = (over: Partial<DeleteAccountPanelProps> = {}) =>
  html(over).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('DeleteAccountPanel', () => {
  it('says what is deleted and what stays', () => {
    const t = text();
    expect(t).toContain('This can’t be undone');
    expect(t).toContain('every workspace that only you run');
    expect(t).toContain('export what you need first');
    expect(t).toContain('Shared workspaces keep their records');
    expect(t).toContain('hansel@gaiada.com');
  });

  it('asks for a password only when the account is not a YourTal one, and explains YourTal only when it is', () => {
    expect(text()).toContain('Your password, if your account has one');
    expect(text()).not.toContain('Your YourTal account');
    const linked = text({ yourtalLinked: true });
    expect(linked).not.toContain('Your password');
    expect(linked).toContain('Your YourTal account isn’t deleted');
  });

  it('keeps the button off until DELETE is typed', () => {
    // Button draws a disabled control at half opacity (its accessibilityState carries the rest).
    const off = (typed: string) => /opacity:0\.5[^>]*>(?:(?!<\/button>).)*Delete my account/.test(html({ typed }));
    expect(off('')).toBe(true);
    expect(off('del')).toBe(true);
    expect(off('DELETE')).toBe(false);
    expect(off(' DELETE ')).toBe(false);
  });

  it('shows a refusal as a sentence', () => {
    expect(text({ error: 'That password is not right.' })).toContain('That password is not right.');
  });
});
