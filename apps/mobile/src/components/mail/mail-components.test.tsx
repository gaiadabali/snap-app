import type { Folder, MailSummary, MessageSummary } from '@snap/mail-engine';
import { IFRAME_SANDBOX, toSandboxDocument } from '@snap/mail-engine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('@/api', () => ({ api: vi.fn() }));
// The real client pulls in the phone's filesystem module, which Node cannot load.
vi.mock('@/lib/mail-client', () => ({ createAppMailClient: vi.fn() }));
vi.mock('@/session', () => ({ useSession: () => ({ session: null, refresh: async () => {} }) }));
vi.mock('@/workspace', () => ({ useWorkspace: () => ({ active: { teenSpace: null }, workspaces: [] }) }));

import { AppPasswordSecret } from './AppPasswords';
import { FolderBar, folderCount } from './FolderBar';
import { GATE_COPY, MailGateView } from './MailGate';
import { MessageBody } from './MessageBody';
import { MessageBody as WebMessageBody } from './MessageBody.web';
import { MessageRow } from './MessageRow';
import { PlainBody, isOpenableLink } from './MessageText';
import { SpamBannerView } from './SpamBanner';
import { SwitchOnView, switchOnMessage } from './SwitchOn';
import { UnsubscribeBar } from './UnsubscribeBar';

const noop = () => {};
const ENTITIES: Record<string, string> = { '&#x27;': "'", '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>' };
/** Markup escapes quotes, ampersands and angle brackets; compare on plain text. One pass, so `&amp;lt;` stays `&lt;`. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:#x27|quot|amp|lt|gt);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ');
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('the browser build body (the second wall)', () => {
  const doc = toSandboxDocument({ html: '<p>Hi</p>', remoteImagesBlocked: 0, inlineImagesDropped: 0, truncated: false });
  const markup = render(createElement(WebMessageBody, { doc, text: 'Hi', title: 'Message from Maria' }));

  it('carries exactly the engine’s sandbox attribute, with no allow-scripts', () => {
    expect(markup).toContain(`sandbox="${IFRAME_SANDBOX}"`);
    expect(markup).not.toContain('allow-scripts');
  });

  it('stops the referrer travelling, names the frame and shows the engine’s CSP-first document', () => {
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('title="Message from Maria"');
    expect(doc.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(markup).toContain('Content-Security-Policy');
  });

  it('draws no frame for plain text', () => {
    const plain = render(createElement(WebMessageBody, { doc: null, text: 'Just words', title: 't' }));
    expect(plain).not.toContain('<iframe');
    expect(text(plain)).toContain('Just words');
  });
});

describe('the fallback body', () => {
  it('never draws HTML, even when given a document', () => {
    const out = render(createElement(MessageBody, { doc: '<p>Hi <script>alert(1)</script></p>', text: 'Plain', title: 't' }));
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('<script');
    expect(text(out)).toContain('Plain');
  });
});

describe('PlainBody', () => {
  it('escapes markup in the text', () => {
    const out = render(createElement(PlainBody, { text: '<img src=x onerror=alert(1)> hello' }));
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('shows a web link as a link, and javascript: and data: as inert text', () => {
    const out = render(createElement(PlainBody, { text: 'see https://example.com/a. Also javascript:alert(1) and data:text/html,<b>' }));
    expect(out).toContain('role="link"');
    expect(text(out)).toContain('https://example.com/a');
    expect((out.match(/role="link"/g) ?? []).length).toBe(1);
  });

  it('only opens web and mail links outside the app', () => {
    for (const url of ['https://a.example', 'http://a.example', 'mailto:me@example.com']) expect(isOpenableLink(url)).toBe(true);
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///x', 'intent://x', 'content://x', 'nope', '']) {
      expect(isOpenableLink(url)).toBe(false);
    }
  });
});

describe('SpamBannerView', () => {
  const summary: MailSummary = {
    address: 'geewizduck@yourtal.gaiada.com',
    counters: { bulkFiled30d: 1234, marketersUnsubscribed: 2, autoRepliesSent30d: 0 },
    banner: {
      title: 'Reach people <b>who</b> want to hear',
      body: 'YourTal shows your brand.',
      ctaLabel: 'Advertise',
      ctaUrl: 'https://yourtal.gaiada.com/studio/onboarding',
    },
  };

  it('shows the YourTal ad as plain text, a button, and the three counters', () => {
    const t = text(render(createElement(SpamBannerView, { summary })));
    expect(t).toContain('From YourTal');
    expect(t).toContain('Reach people <b>who</b> want to hear');
    expect(t).toContain('Advertise');
    expect(t).toContain('1,234');
    expect(t).toContain('Bulk mail filed, last 30 days');
    expect(t).toContain('Senders you have unsubscribed from');
    expect(t).toContain('Replies sent to marketers, last 30 days');
  });

  it('draws no button when the server’s link is not https', () => {
    for (const ctaUrl of ['javascript:alert(1)', 'http://yourtal.gaiada.com', 'data:text/html,x']) {
      const t = text(render(createElement(SpamBannerView, { summary: { ...summary, banner: { ...summary.banner!, ctaUrl } } })));
      expect(t).not.toContain('Advertise');
      expect(t).toContain('Reach people');
    }
  });

  it('still shows the counters with no banner, and nothing before the summary arrives', () => {
    const noBanner = text(render(createElement(SpamBannerView, { summary: { ...summary, banner: null } })));
    expect(noBanner).not.toContain('From YourTal');
    expect(noBanner).toContain('1,234');
    expect(render(createElement(SpamBannerView, { summary: null }))).toBe('');
  });
});

describe('FolderBar', () => {
  const folders: Folder[] = [
    { key: 'inbox', mailboxId: 'a', unread: 3, total: 8 },
    { key: 'spam', mailboxId: 'b', unread: 0, total: 3 },
    { key: 'junk', mailboxId: 'c', unread: 2, total: 4 },
    { key: 'sent', mailboxId: 'd', unread: 0, total: 9 },
    { key: 'drafts', mailboxId: 'e', unread: 0, total: 1 },
    { key: 'trash', mailboxId: 'f', unread: 0, total: 5 },
  ];

  it('lists the six folders in order with the app’s own labels', () => {
    const t = text(render(createElement(FolderBar, { folders, active: 'inbox', onSelect: noop })));
    const order = ['Inbox', 'Spam', 'Junk', 'Sent', 'Drafts', 'Trash'].map((l) => t.indexOf(l));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('marks only the open folder', () => {
    const markup = render(createElement(FolderBar, { folders, active: 'spam', onSelect: noop }));
    expect((markup.match(/aria-selected="true"/g) ?? []).length).toBe(1);
  });

  it('counts unread for mail folders, the total for Drafts, nothing for Sent and Trash', () => {
    expect(folderCount(folders[0])).toBe(3);
    expect(folderCount(folders[1])).toBe(0);
    expect(folderCount(folders[2])).toBe(2);
    expect(folderCount(folders[4])).toBe(1);
    expect(folderCount(folders[3])).toBe(0);
    expect(folderCount(folders[5])).toBe(0);
    expect(folderCount(undefined)).toBe(0);
    const markup = render(createElement(FolderBar, { folders, active: 'inbox', onSelect: noop }));
    expect(markup).toContain('Inbox, 3 unread');
    expect(markup).toContain('Drafts, 1 draft');
  });

  it('works before the folders have loaded', () => {
    const t = text(render(createElement(FolderBar, { folders: [], active: null, onSelect: noop })));
    expect(t).toContain('Junk');
  });
});

describe('MessageRow', () => {
  const m: MessageSummary = {
    id: 'm1',
    threadId: 't1',
    folder: 'inbox',
    from: { name: 'Maria Santos', email: 'maria@example.com' },
    to: [{ email: 'me@yourtal.gaiada.com' }],
    subject: 'Lunch on Friday?',
    preview: 'Hi Gee, are you free for lunch',
    receivedAt: '2026-11-20T02:00:00.000Z',
    unread: true,
    flagged: false,
    hasAttachment: true,
    bulk: false,
  };
  const row = (over: Partial<Parameters<typeof MessageRow>[0]> = {}) =>
    render(
      createElement(MessageRow, {
        message: m,
        selected: false,
        selecting: false,
        onOpen: noop,
        onToggle: noop,
        onFlag: noop,
        now: new Date('2026-11-27T02:00:00.000Z'),
        ...over,
      }),
    );

  it('names who, what, when and the state for a screen reader', () => {
    const markup = row();
    expect(markup).toContain('Unread, Maria Santos, Lunch on Friday?, 20 Nov, has attachments');
    expect(text(markup)).toContain('Hi Gee, are you free for lunch');
  });

  it('shows recipients in Sent and Drafts, and says so', () => {
    expect(text(row({ message: { ...m, folder: 'sent', unread: false } }))).toContain('To: me@yourtal.gaiada.com');
  });

  it('shows (no subject), the folder in search, and a star state', () => {
    const t = text(row({ message: { ...m, subject: '  ', flagged: true }, showFolder: true }));
    expect(t).toContain('(no subject)');
    expect(t).toContain('Inbox');
    expect(row({ message: { ...m, flagged: true } })).toContain('Remove star');
    expect(row()).toContain('Star this message');
  });

  it('says what a tap does while selecting', () => {
    // A selected row is marked as such; the hint itself is native-only (accessibilityHint).
    expect(row({ selecting: true, selected: true })).toContain('aria-selected="true"');
    expect(row({ selecting: true })).not.toContain('aria-selected="true"');
  });
});

describe('UnsubscribeBar', () => {
  const base = { message: { from: { name: 'Shop', email: 's@shop.example' } }, folder: 'inbox' as const, moveToJunk: true, onToggleMove: noop, onUnsubscribe: noop };

  it('offers to move the message to Junk, except where it already is', () => {
    expect(text(render(createElement(UnsubscribeBar, { ...base, state: { step: 'idle' } })))).toContain('Also move this message to Junk');
    expect(text(render(createElement(UnsubscribeBar, { ...base, folder: 'junk', state: { step: 'idle' } })))).not.toContain('Also move');
    expect(text(render(createElement(UnsubscribeBar, { ...base, folder: 'spam', state: { step: 'idle' } })))).not.toContain('Also move');
  });

  it('says it is done, and whether the message moved', () => {
    const done = { step: 'done', result: { status: 'done', method: 'one_click' }, moved: true } as const;
    const t = text(render(createElement(UnsubscribeBar, { ...base, state: done })));
    expect(t).toContain('Unsubscribed. Shop has been told to stop.');
    expect(t).toContain('moved to Junk');
  });

  it('offers a safe link only for https, and explains when it is withheld', () => {
    expect(text(render(createElement(UnsubscribeBar, { ...base, state: { step: 'link', url: 'https://shop.example/unsub' } })))).toContain('Open the unsubscribe page');
    const bad = text(render(createElement(UnsubscribeBar, { ...base, state: { step: 'link', url: 'javascript:alert(1)' } })));
    expect(bad).not.toContain('Open the unsubscribe page');
    expect(bad).toContain('not safe to open');
  });

  it('explains a failure in the right words', () => {
    expect(text(render(createElement(UnsubscribeBar, { ...base, state: { step: 'failed', unavailable: true } })))).toContain('does not offer a way to unsubscribe');
    expect(text(render(createElement(UnsubscribeBar, { ...base, state: { step: 'failed', unavailable: false } })))).toContain('That did not go through');
  });
});

describe('SwitchOnView', () => {
  const view = (phase: Parameters<typeof SwitchOnView>[0]['phase']) =>
    text(render(createElement(SwitchOnView, { phase, onSwitchOn: noop, onContinue: noop })));

  it('explains what switching on does, with the website’s words', () => {
    const t = view({ step: 'idle' });
    expect(t).toContain('Get your own Spambank inbox');
    expect(t).toContain('Switch on mail');
    expect(t).toContain('geewizduck@yourtal.gaiada.com');
    expect(t).toContain('For adults.');
  });

  it('shows the new address and a way in', () => {
    const t = view({ step: 'done', address: 'wobblyotter@yourtal.gaiada.com' });
    expect(t).toContain('Your inbox is ready');
    expect(t).toContain('wobblyotter@yourtal.gaiada.com');
    expect(t).toContain('Open your inbox');
  });

  it('shows progress and a failure', () => {
    expect(view({ step: 'working' })).toContain('Setting up your inbox');
    expect(view({ step: 'error', message: 'Mail is not available right now.' })).toContain('Mail is not available right now.');
  });

  it('words a refusal for an adult-only service', () => {
    expect(switchOnMessage({ status: 403, code: 'not_allowed' })).toContain('adult accounts');
    expect(switchOnMessage({ status: 409, code: 'yourtal_not_linked' })).toBe('Sign in with YourTal to use mail.');
    expect(switchOnMessage(new Error('x'))).toBe('Something went wrong. Try again in a moment.');
  });
});

describe('AppPasswordSecret', () => {
  const created = {
    id: 'ap1',
    name: 'Pixel mail',
    createdAt: '2026-11-27T01:00:00.000Z',
    secret: 'abcd-efgh-ijkl-mnop',
    username: 'geewizduck@yourtal.gaiada.com',
    imap: { host: 'mail.yourtal.gaiada.com', port: 993, security: 'ssl' as const },
    smtp: { host: 'mail.yourtal.gaiada.com', port: 465, security: 'ssl' as const },
  };

  it('shows the secret once, with everything a phone mail app needs', () => {
    const t = text(render(createElement(AppPasswordSecret, { created, onDone: noop })));
    expect(t).toContain('Pixel mail');
    expect(t).toContain('This is the only time you will see this password.');
    expect(t).toContain('abcd-efgh-ijkl-mnop');
    expect(t).toContain('mail.yourtal.gaiada.com · port 993 · SSL/TLS');
    expect(t).toContain('mail.yourtal.gaiada.com · port 465 · SSL/TLS');
    expect(t).toContain('I have copied it');
  });

  it('never puts the secret into an accessibility label', () => {
    const markup = render(createElement(AppPasswordSecret, { created, onDone: noop }));
    expect(markup).toContain('aria-label="Copy password"');
    const labels = [...markup.matchAll(/aria-label="([^"]*)"/g)].map((x) => x[1]);
    expect(labels.some((l) => l?.includes('abcd'))).toBe(false);
  });
});

describe('MailGateView', () => {
  const view = (over: Partial<Parameters<typeof MailGateView>[0]> = {}) =>
    text(
      render(
        createElement(MailGateView, {
          gate: null,
          loading: false,
          onRetry: noop,
          onSwitchedOn: noop,
          onLinked: noop,
          ...over,
        }),
      ),
    );

  it('shows the website’s sentence for each state with no inbox', () => {
    for (const kind of ['unavailable', 'notAllowed', 'suspended'] as const) {
      const t = view({ gate: { kind } });
      expect(t).toContain(GATE_COPY[kind].title);
      expect(t).toContain(GATE_COPY[kind].body);
    }
    expect(GATE_COPY.notAllowed.body).toBe('Spambank mail is for adult accounts.');
  });

  it('offers a retry when the read failed, and nothing alarming while loading', () => {
    expect(view()).toContain('Try again');
    expect(view()).toContain(GATE_COPY.failed.body);
    expect(view({ loading: true })).not.toContain('Try again');
  });

  it('asks an unlinked account to sign in with YourTal', () => {
    const t = view({ gate: { kind: 'unlinked' } });
    expect(t).toContain('Sign in with YourTal to keep your account');
  });

  it('offers to switch on when there is no mailbox yet', () => {
    expect(view({ gate: { kind: 'off' } })).toContain('Switch on mail');
  });
});
