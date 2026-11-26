import { describe, expect, it } from 'vitest';

import { composeHref, folderHref, messageHref, resolveMailRoute, searchHref } from './mail-routes';

describe('resolveMailRoute', () => {
  it('opens the Inbox at the root and for /inbox', () => {
    expect(resolveMailRoute(undefined)).toEqual({ view: 'folder', folder: 'inbox' });
    expect(resolveMailRoute([])).toEqual({ view: 'folder', folder: 'inbox' });
    expect(resolveMailRoute(['inbox'])).toEqual({ view: 'folder', folder: 'inbox' });
  });

  it('knows all six folders', () => {
    for (const folder of ['inbox', 'spam', 'junk', 'sent', 'drafts', 'trash'] as const) {
      expect(resolveMailRoute([folder])).toEqual({ view: 'folder', folder });
    }
  });

  it('reads search text and caps it', () => {
    expect(resolveMailRoute(['search'], { q: 'invoice' })).toEqual({ view: 'search', q: 'invoice' });
    expect(resolveMailRoute(['search'])).toEqual({ view: 'search', q: '' });
    const long = resolveMailRoute(['search'], { q: 'x'.repeat(500) });
    expect(long).toMatchObject({ view: 'search' });
    expect(long && long.view === 'search' && long.q.length).toBe(200);
  });

  it('resolves a message by id and refuses anything that is not an id', () => {
    expect(resolveMailRoute(['message', 'M12_ab-3'])).toEqual({ view: 'message', id: 'M12_ab-3' });
    expect(resolveMailRoute(['message', 'a/b'])).toBeNull();
    expect(resolveMailRoute(['message', '..%2F..'])).toBeNull();
    expect(resolveMailRoute(['message', '<script>'])).toBeNull();
    expect(resolveMailRoute(['message'])).toBeNull();
  });

  it('resolves compose: new needs no id, reply and forward and draft do', () => {
    expect(resolveMailRoute(['compose'])).toEqual({ view: 'compose', mode: 'new', id: null });
    expect(resolveMailRoute(['compose'], { mode: 'reply', id: 'm1' })).toEqual({ view: 'compose', mode: 'reply', id: 'm1' });
    expect(resolveMailRoute(['compose'], { mode: 'replyAll', id: 'm1' })).toMatchObject({ mode: 'replyAll' });
    expect(resolveMailRoute(['compose'], { mode: 'forward', id: 'm1' })).toMatchObject({ mode: 'forward' });
    expect(resolveMailRoute(['compose'], { mode: 'draft', id: 'm18' })).toMatchObject({ mode: 'draft', id: 'm18' });
    expect(resolveMailRoute(['compose'], { mode: 'reply' })).toBeNull();
    expect(resolveMailRoute(['compose'], { mode: 'reply', id: 'bad id' })).toBeNull();
    expect(resolveMailRoute(['compose'], { mode: 'teleport', id: 'm1' })).toBeNull();
  });

  it('answers null for anything else', () => {
    expect(resolveMailRoute(['nope'])).toBeNull();
    expect(resolveMailRoute(['inbox', 'extra'])).toBeNull();
    expect(resolveMailRoute(['settings'])).toEqual({ view: 'settings' });
  });
});

describe('hrefs', () => {
  it('build the same URLs the resolver reads, under any base', () => {
    expect(folderHref('/app/mail', 'inbox')).toBe('/app/mail');
    expect(folderHref('/app/mail', 'spam')).toBe('/app/mail/spam');
    expect(messageHref('/mail-preview', 'm 1')).toBe('/mail-preview/message/m%201');
    expect(searchHref('/app/mail', 'a&b')).toBe('/app/mail/search?q=a%26b');
    expect(composeHref('/app/mail')).toBe('/app/mail/compose');
    expect(composeHref('/app/mail', 'reply', 'm1')).toBe('/app/mail/compose?mode=reply&id=m1');
  });
});
