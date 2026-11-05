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
    expect(t).toContain('every workspace where you are the only owner or manager');
    expect(t).toContain('export what you need first');
    expect(t).toContain('A workspace where another owner or manager remains keeps its records');
    expect(t).toContain('database backups up to 30 days, stored files up to 90 days and off-site backup copies up to 12 months');
    expect(t).toContain('Free Tax Returns');
    expect(t).toContain('hansel@gaiada.com');
    expect(t).toContain('within 30 days');
    expect(t).not.toContain('Your teen');
  });

  it('tells a teen the space goes within 30 days, and a parent what happens to their teen', () => {
    const teen = text({ teenRole: 'teen', yourtalLinked: true });
    expect(teen).toContain('deleted within 30 days, and your parent is told');
    expect(teen).not.toContain('What stays');
    expect(teen).not.toContain('start with a new, empty account');
    const parent = text({ teenRole: 'parent' });
    expect(parent).toContain('ends your teen’s access to SnapApp first');
    expect(parent).toContain('deleted after 30 days');
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
