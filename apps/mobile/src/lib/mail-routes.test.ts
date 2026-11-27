import { describe, expect, it } from 'vitest';

import {
  composeHref,
  folderHref,
  isMailId,
  messageHref,
  parseCompose,
  parseFolder,
  parseSearch,
  searchHref,
  settingsHref,
} from './mail-routes';

describe('mail routes', () => {
  it('reads a folder, defaulting to the Inbox for anything else', () => {
    expect(parseFolder(undefined)).toBe('inbox');
    expect(parseFolder('spam')).toBe('spam');
    expect(parseFolder(['trash', 'spam'])).toBe('trash');
    expect(parseFolder('../etc')).toBe('inbox');
    expect(parseFolder('')).toBe('inbox');
  });

  it('trims and caps a search', () => {
    expect(parseSearch('  invoice ')).toBe('invoice');
    expect(parseSearch('x'.repeat(500))).toHaveLength(200);
    expect(parseSearch(undefined)).toBe('');
  });

  it('accepts only real message ids', () => {
    expect(isMailId('M1a-b_2')).toBe(true);
    for (const bad of ['', undefined, null, 'a b', '../x', 'x'.repeat(129), 'a/b']) expect(isMailId(bad)).toBe(false);
  });

  it('resolves compose parameters', () => {
    expect(parseCompose(undefined, undefined)).toEqual({ mode: 'new', id: null });
    expect(parseCompose('new', 'ignored')).toEqual({ mode: 'new', id: null });
    expect(parseCompose('reply', 'M1')).toEqual({ mode: 'reply', id: 'M1' });
    expect(parseCompose('replyAll', 'M1')).toEqual({ mode: 'replyAll', id: 'M1' });
    expect(parseCompose('forward', 'M1')).toEqual({ mode: 'forward', id: 'M1' });
    expect(parseCompose('draft', 'D9')).toEqual({ mode: 'draft', id: 'D9' });
  });

  it('refuses a reply with no message, a bad id or an unknown mode', () => {
    expect(parseCompose('reply', undefined)).toBeNull();
    expect(parseCompose('reply', 'a b')).toBeNull();
    expect(parseCompose('bcc', 'M1')).toBeNull();
  });

  it('builds hrefs the screens above can read back', () => {
    expect(folderHref('inbox')).toBe('/mail');
    expect(folderHref('spam')).toBe('/mail?folder=spam');
    expect(searchHref('a b&c')).toBe('/mail?q=a%20b%26c');
    expect(messageHref('M 1')).toBe('/mail/M%201');
    expect(settingsHref()).toBe('/mail/settings');
    expect(composeHref()).toBe('/mail/compose');
    expect(composeHref('reply')).toBe('/mail/compose');
    expect(composeHref('forward', 'M1')).toBe('/mail/compose?mode=forward&id=M1');
  });
});
