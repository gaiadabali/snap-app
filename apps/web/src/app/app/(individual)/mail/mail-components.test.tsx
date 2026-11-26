import type { Folder, MailSummary, MessageDetail, MessageSummary } from '@snap/mail-engine';
import { IFRAME_SANDBOX, toSandboxDocument } from '@snap/mail-engine';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppPasswordSecret } from './AppPasswords';
import { FolderRailView, activeFolder, folderCount } from './FolderRail';
import { PlainBody, SandboxFrame } from './MessageBody';
import { MessageRow } from './MessageRow';
import { UnsubscribeBar } from './Reader';
import { SpamBannerView } from './SpamBanner';
import { SwitchOnView } from './SwitchOn';

const noop = () => {};
/** Markup escapes quotes and ampersands; compare on plain text. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('SandboxFrame (the second wall)', () => {
  const doc = toSandboxDocument({ html: '<p>Hi</p>', remoteImagesBlocked: 0, inlineImagesDropped: 0, truncated: false });
  const markup = renderToStaticMarkup(<SandboxFrame doc={doc} title="Message from Maria" />);

  it('carries exactly the engine’s sandbox attribute, with no allow-scripts', () => {
    expect(markup).toContain(`sandbox="${IFRAME_SANDBOX}"`);
    expect(markup).not.toContain('allow-scripts');
    expect(IFRAME_SANDBOX).not.toContain('allow-scripts');
  });

  it('stops the referrer travelling and names the frame', () => {
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('title="Message from Maria"');
  });

  it('shows the engine’s document, whose first element is the CSP meta', () => {
    expect(doc.startsWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(markup).toContain('srcDoc=');
    expect(markup).toContain('Content-Security-Policy');
  });
});

describe('PlainBody', () => {
  it('escapes markup and links only http(s)', () => {
    const markup = renderToStaticMarkup(
      <PlainBody text={'<img src=x onerror=alert(1)> see https://example.com/a. Also javascript:alert(1) and data:text/html,<b>'} />,
    );
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img');
    expect(markup).toContain('href="https://example.com/a"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain('href="data:');
  });
});

describe('SpamBannerView', () => {
  const summary: MailSummary = {
    address: 'geewizduck@yourtal.gaiada.com',
    counters: { bulkFiled30d: 1234, marketersUnsubscribed: 2, autoRepliesSent30d: 0 },
    banner: { title: 'Reach people <b>who</b> want to hear', body: 'YourTal shows your brand.', ctaLabel: 'Advertise', ctaUrl: 'https://yourtal.gaiada.com/studio/onboarding' },
  };

  it('shows the YourTal ad as plain text, a safe link, and the three counters', () => {
    const markup = renderToStaticMarkup(<SpamBannerView summary={summary} />);
    expect(markup).toContain('From YourTal');
    expect(markup).toContain('Reach people &lt;b&gt;who&lt;/b&gt; want to hear');
    expect(markup).toContain('href="https://yourtal.gaiada.com/studio/onboarding"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(text(markup)).toContain('1,234');
    expect(text(markup)).toContain('Bulk mail filed, last 30 days');
    expect(text(markup)).toContain('Senders you have unsubscribed from');
  });

  it('draws no button when the server’s link is not https', () => {
    for (const ctaUrl of ['javascript:alert(1)', 'http://yourtal.gaiada.com', 'data:text/html,x']) {
      const markup = renderToStaticMarkup(<SpamBannerView summary={{ ...summary, banner: { ...summary.banner!, ctaUrl } }} />);
      expect(markup).not.toContain('<a ');
      expect(markup).toContain('Reach people');
    }
  });

  it('still shows the counters when there is no banner, and nothing before the summary arrives', () => {
    expect(renderToStaticMarkup(<SpamBannerView summary={{ ...summary, banner: null }} />)).not.toContain('From YourTal');
    expect(renderToStaticMarkup(<SpamBannerView summary={{ ...summary, banner: null }} />)).toContain('1,234');
    expect(renderToStaticMarkup(<SpamBannerView summary={null} />)).toBe('');
  });
});

describe('FolderRailView', () => {
  const folders: Folder[] = [
    { key: 'inbox', mailboxId: 'a', unread: 3, total: 8 },
    { key: 'spam', mailboxId: 'b', unread: 0, total: 3 },
    { key: 'junk', mailboxId: 'c', unread: 2, total: 4 },
    { key: 'sent', mailboxId: 'd', unread: 0, total: 9 },
    { key: 'drafts', mailboxId: 'e', unread: 0, total: 1 },
    { key: 'trash', mailboxId: 'f', unread: 0, total: 5 },
  ];

  it('lists the six folders in order, with the app’s own labels, and the settings link', () => {
    const markup = renderToStaticMarkup(<FolderRailView base="/app/mail" folders={folders} active="inbox" />);
    const order = ['Inbox', 'Spam', 'Junk', 'Sent', 'Drafts', 'Trash', 'Mail settings'].map((l) => markup.indexOf(`>${l}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markup).toContain('href="/app/mail"');
    expect(markup).toContain('href="/app/mail/spam"');
    expect(markup).toContain('href="/app/mail/settings"');
  });

  it('marks the open folder, and counts unread for mail folders, the total for Drafts, nothing for Sent and Trash', () => {
    const markup = renderToStaticMarkup(<FolderRailView base="/app/mail" folders={folders} active="spam" />);
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(folderCount(folders[0])).toBe(3);
    expect(folderCount(folders[1])).toBe(0);
    expect(folderCount(folders[4])).toBe(1);
    expect(folderCount(folders[3])).toBe(0);
    expect(folderCount(folders[5])).toBe(0);
    expect(folderCount(undefined)).toBe(0);
  });

  it('works before the folders have loaded', () => {
    const markup = renderToStaticMarkup(<FolderRailView base="/mail-preview" folders={[]} active={null} />);
    expect(markup).toContain('href="/mail-preview/junk"');
    expect(markup).not.toContain('aria-current');
  });

  it('reads the active folder from the URL under any base', () => {
    expect(activeFolder('/app/mail', '/app/mail')).toBe('inbox');
    expect(activeFolder('/app/mail/trash', '/app/mail')).toBe('trash');
    expect(activeFolder('/app/mail/message/m1', '/app/mail')).toBeNull();
    expect(activeFolder('/app/mail/settings', '/app/mail')).toBeNull();
    expect(activeFolder('/mail-preview/junk', '/mail-preview')).toBe('junk');
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
  const render = (over: Partial<MessageSummary> = {}, props: { showFolder?: boolean } = {}) =>
    renderToStaticMarkup(
      <ul>
        <MessageRow message={{ ...m, ...over }} href="/app/mail/message/m1" selected={false} onSelect={noop} onFlag={noop} now={new Date('2026-11-27T05:00:00')} {...props} />
      </ul>,
    );

  it('shows who, what, a preview, the date, and says when it is unread or has attachments', () => {
    const markup = render();
    const t = text(markup);
    expect(t).toContain('Maria Santos');
    expect(t).toContain('Lunch on Friday?');
    expect(t).toContain('Hi Gee, are you free for lunch');
    expect(t).toContain('(unread)');
    expect(t).toContain('Has attachments');
    expect(markup).toContain('data-unread="true"');
    expect(markup).toContain('href="/app/mail/message/m1"');
  });

  it('keeps the checkbox and the star outside the link, so they never open the message', () => {
    const markup = render();
    const link = markup.slice(markup.indexOf('<a '), markup.indexOf('</a>'));
    expect(link).not.toContain('type="checkbox"');
    expect(link).not.toContain('aria-pressed');
  });

  it('shows the recipients in Sent, and a placeholder for an empty subject', () => {
    expect(text(render({ folder: 'sent', unread: false, to: [{ name: 'Dev Patel', email: 'dev@example.org' }] }))).toContain('To: Dev Patel');
    expect(text(render({ subject: '   ' }))).toContain('(no subject)');
  });

  it('names the folder in search results only', () => {
    expect(text(render({ folder: 'junk' }, { showFolder: true }))).toContain('Junk');
    expect(text(render({ folder: 'junk' }))).not.toContain('Junk');
  });

  it('states whether the star is on', () => {
    expect(render({ flagged: true })).toContain('aria-pressed="true"');
    expect(render({ flagged: false })).toContain('aria-pressed="false"');
  });
});

describe('UnsubscribeBar', () => {
  const message = {
    folder: 'inbox',
    from: { name: 'Weekly Deals', email: 'news@dealsweekly.example' },
    unsubscribe: 'one_click',
  } as unknown as MessageDetail;
  const bar = (state: Parameters<typeof UnsubscribeBar>[0]['state'], msg: MessageDetail = message) =>
    renderToStaticMarkup(<UnsubscribeBar message={msg} state={state} moveToJunk onToggleMove={noop} onUnsubscribe={noop} />);

  it('offers one tap, with the move-to-Junk choice where it makes sense', () => {
    const t = text(bar({ step: 'idle' }));
    expect(t).toContain('Stop mail from Weekly Deals');
    expect(t).toContain('Unsubscribe');
    expect(t).toContain('Also move this message to Junk');
    expect(text(bar({ step: 'idle' }, { ...message, folder: 'junk' } as MessageDetail))).not.toContain('Also move');
    expect(text(bar({ step: 'idle' }, { ...message, folder: 'spam' } as MessageDetail))).not.toContain('Also move');
  });

  it('says done, and says when the message was moved', () => {
    const done = text(bar({ step: 'done', result: { status: 'done', method: 'one_click' }, moved: true }));
    expect(done).toContain('Unsubscribed.');
    expect(done).toContain('moved to Junk');
    expect(text(bar({ step: 'done', result: { status: 'done', method: 'mailto' }, moved: false }))).not.toContain('moved to Junk');
  });

  it('opens a sender’s own page only when it is https', () => {
    const ok = bar({ step: 'link', url: 'https://lists.example/unsub/1' });
    expect(ok).toContain('href="https://lists.example/unsub/1"');
    expect(ok).toContain('rel="noopener noreferrer"');
    for (const url of ['javascript:alert(1)', 'http://lists.example/u', 'data:text/html,x']) {
      expect(bar({ step: 'link', url })).not.toContain('<a ');
    }
  });

  it('explains a failure, and the difference between “not offered” and “try again”', () => {
    expect(text(bar({ step: 'failed', unavailable: true }))).toContain('does not offer a way to unsubscribe');
    expect(text(bar({ step: 'failed', unavailable: false }))).toContain('did not go through');
  });
});

describe('SwitchOnView', () => {
  it('invites, with the button, in plain adult language', () => {
    const markup = renderToStaticMarkup(<SwitchOnView phase={{ step: 'idle' }} onSwitchOn={noop} onContinue={noop} />);
    const t = text(markup);
    expect(t).toContain('Get your own Spambank inbox');
    expect(t).toContain('Switch on mail');
    expect(t).toContain('For adults');
    expect(t).toContain('That is off until you turn it on');
  });

  it('disables the button while it works, and shows a failure', () => {
    expect(renderToStaticMarkup(<SwitchOnView phase={{ step: 'working' }} onSwitchOn={noop} onContinue={noop} />)).toContain('disabled=""');
    const failed = renderToStaticMarkup(<SwitchOnView phase={{ step: 'error', message: 'Mail is for adult accounts.' }} onSwitchOn={noop} onContinue={noop} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('Mail is for adult accounts.');
  });

  it('shows the generated address once it is made', () => {
    const markup = renderToStaticMarkup(<SwitchOnView phase={{ step: 'done', address: 'geewizduck@yourtal.gaiada.com' }} onSwitchOn={noop} onContinue={noop} />);
    expect(markup).toContain('data-testid="new-address"');
    expect(text(markup)).toContain('geewizduck@yourtal.gaiada.com');
    expect(text(markup)).toContain('Open your inbox');
  });
});

describe('AppPasswordSecret', () => {
  const created = {
    id: 'ap1',
    name: 'Pixel mail',
    createdAt: '2026-11-28T01:00:00Z',
    secret: 'app_abc123',
    username: 'geewizduck@yourtal.gaiada.com',
    imap: { host: 'mail.yourtal.gaiada.com', port: 993, security: 'ssl' as const },
    smtp: { host: 'mail.yourtal.gaiada.com', port: 465, security: 'ssl' as const },
  };
  const markup = renderToStaticMarkup(<AppPasswordSecret created={created} onDone={noop} />);
  const t = text(markup);

  it('shows the secret with everything a phone app needs, and says it is shown once', () => {
    expect(t).toContain('app_abc123');
    expect(t).toContain('geewizduck@yourtal.gaiada.com');
    expect(t).toContain('mail.yourtal.gaiada.com · port 993 · SSL/TLS');
    expect(t).toContain('mail.yourtal.gaiada.com · port 465 · SSL/TLS');
    expect(t).toContain('only time you will see this password');
    expect(t).toContain('I have copied it');
  });
});
