import type { YourtalLinkStatus } from '@snap/api-contract';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LINK_ERROR_CODES, linkErrorMessage } from '@/lib/yourtal-link';

import { YourtalLinkLoading, YourtalLinkView, type YourtalLinkViewProps } from './YourtalLinkView';

const noop = () => {};

const STATUS: YourtalLinkStatus = {
  available: true,
  state: 'unlinked',
  region: null,
  linkedAt: null,
  brokenReason: null,
  receipts: { pending: 0, rewarded: 0, refused: 0, skippedDuplicate: 0 },
  pointsReported: 0,
};

function html(over: Partial<YourtalLinkViewProps> & { status?: Partial<YourtalLinkStatus> } = {}): string {
  const { status, ...rest } = over;
  const props: YourtalLinkViewProps = {
    load: { kind: 'ready', status: { ...STATUS, ...status } },
    links: { getCode: 'https://yt.test/me', wallet: 'https://yt.test/wallet' },
    retryHref: '/app/points',
    verifyEmailHref: '/verify-email',
    code: '',
    onCodeChange: noop,
    onLink: noop,
    busy: null,
    error: null,
    confirming: false,
    onAskUnlink: noop,
    onCancelUnlink: noop,
    onConfirmUnlink: noop,
    ...rest,
  };
  return renderToStaticMarkup(<YourtalLinkView {...props} />);
}

/** Markup escapes quotes and ampersands; compare on plain text. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('YourtalLinkView: unlinked', () => {
  it('explains the link, points to YourTal for a code, and offers a code field and a Link button', () => {
    const markup = html();
    const t = text(markup);
    expect(t).toContain('Link your YourTal account');
    expect(t).toContain('10 for each receipt in Australia');
    expect(t).toContain('Get a code in YourTal');
    expect(t).toContain('Me → Linked apps');
    expect(t).toContain('Link code');
    expect(t).toContain('Link YourTal');
    expect(markup).toContain('placeholder="Paste the code"');
    expect(markup).toContain('href="https://yt.test/me"');
  });

  it('disables the Link button until a code is typed', () => {
    expect(html({ code: '' })).toMatch(/<button[^>]* disabled=""[^>]*>Link YourTal/);
    expect(html({ code: '   ' })).toMatch(/<button[^>]* disabled=""[^>]*>Link YourTal/);
    expect(html({ code: 'ABC123' })).not.toMatch(/<button[^>]* disabled=""[^>]*>Link YourTal/);
  });

  it('shows a request in flight', () => {
    expect(text(html({ code: 'ABC123', busy: 'link' }))).toContain('Linking…');
  });
});

describe('YourtalLinkView: linked', () => {
  const linked: Partial<YourtalLinkStatus> = {
    state: 'linked',
    region: 'AU',
    linkedAt: '2026-10-20T03:00:00.000Z',
    receipts: { pending: 2, rewarded: 12, refused: 0, skippedDuplicate: 3 },
    pointsReported: 120,
  };

  it('shows Linked to YourTal, the date, the receipt counts and the points reported', () => {
    const t = text(html({ status: linked }));
    expect(t).toContain('Linked to YourTal');
    expect(t).toContain('Since 20 Oct 2026');
    expect(t).toMatch(/Receipts rewarded 12/);
    expect(t).toMatch(/Waiting for YourTal 2/);
    expect(t).toMatch(/Skipped as duplicates 3/);
    expect(t).toMatch(/Points reported 120/);
    expect(t).toContain('Your balance is in your YourTal wallet');
  });

  it('offers the wallet link and an Unlink button, and no code form', () => {
    const markup = html({ status: linked });
    const t = text(markup);
    expect(t).toContain('Open my YourTal wallet');
    expect(markup).toContain('href="https://yt.test/wallet"');
    expect(markup).toMatch(/<button[^>]*>Unlink<\/button>/);
    expect(t).not.toContain('Link code');
  });

  it('hides the refused row when nothing was refused, and shows it when something was', () => {
    expect(text(html({ status: linked }))).not.toContain('Not paid by YourTal');
    const refused = { ...linked, receipts: { ...linked.receipts!, refused: 4 } };
    expect(text(html({ status: refused }))).toMatch(/Not paid by YourTal 4/);
  });

  it('asks before unlinking, and the confirm step says what happens', () => {
    expect(text(html({ status: linked }))).not.toContain('Unlink YourTal?');
    const t = text(html({ status: linked, confirming: true }));
    expect(t).toContain('Unlink YourTal?');
    expect(t).toContain('New receipts will stop earning points');
    expect(t).toContain('Points you already have stay in your YourTal wallet');
    expect(t).toContain('Keep linked');
  });

  it('shows an unlink failure as still linked', () => {
    const t = text(html({ status: linked, error: { context: 'unlink', code: 'yourtal_unavailable' } }));
    expect(t).toContain('you are still linked');
  });
});

describe('YourtalLinkView: broken', () => {
  it('says the link ended and offers to link again', () => {
    const t = text(
      html({ status: { state: 'broken', brokenReason: 'link_revoked', linkedAt: '2026-10-01T00:00:00.000Z' } }),
    );
    expect(t).toContain('Your YourTal link ended');
    expect(t).toContain('Link again to start earning');
    expect(t).toContain('Link code');
    expect(t).toContain('Link again');
    expect(t).not.toContain('Linked to YourTal');
  });
});

describe('YourtalLinkView: loading, error, unavailable', () => {
  it('shows a loading state', () => {
    expect(renderToStaticMarkup(<YourtalLinkLoading />)).toContain('Loading your YourTal link');
  });

  it('shows a load error with a retry that reloads the page', () => {
    const markup = html({ load: { kind: 'error' } });
    expect(text(markup)).toContain('Could not load your YourTal link.');
    expect(text(markup)).toContain('Try again');
    expect(markup).toContain('href="/app/points"');
  });

  it('renders nothing at all when the feature is off', () => {
    expect(html({ status: { available: false } })).toBe('');
    // Whatever state the server reports, off is off.
    expect(html({ status: { available: false, state: 'linked' } })).toBe('');
    expect(html({ status: { available: false, state: 'broken' } })).toBe('');
  });
});

describe('YourtalLinkView: every error code is shown', () => {
  it.each(LINK_ERROR_CODES)('%s', (code) => {
    const expected = linkErrorMessage(code, 'link').text;
    const t = text(html({ error: { context: 'link', code } }));
    expect(t).toContain(expected);
  });

  it('shows the teen refusal in the words the founder asked for', () => {
    const t = text(html({ error: { context: 'link', code: 'teen_consent_not_allowed' } }));
    expect(t).toContain("YourTal accounts for 13 to 17 year olds can't earn points from receipts.");
  });

  it('links the unverified-email case to the existing email confirmation page', () => {
    const markup = html({ error: { context: 'link', code: 'email_unverified' } });
    expect(text(markup)).toContain('Confirm your email address first');
    expect(markup).toMatch(/<a href="\/verify-email"[^>]*>Confirm your email<\/a>/);
    const other = html({ error: { context: 'link', code: 'rate_limited' } });
    expect(text(other)).not.toContain('Confirm your email');
  });

  it('falls back to a safe sentence for a failure with no code', () => {
    const t = text(html({ error: { context: 'link', code: null } }));
    expect(t).toContain('Could not link YourTal. Check your connection and try again.');
  });
});
