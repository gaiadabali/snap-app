import type { FamilyStatus } from '@snap/api-contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FamilyPanel, TeenNotice, type FamilyPanelProps } from './FamilyPanel';

const noop = () => {};
const STATUS: FamilyStatus = { invitesAvailable: true, teens: [], pendingInvites: [], asTeen: null };
const TEEN = { workspaceId: 'ws-teen', teenName: 'Tia', joinedAt: '2026-11-01T01:00:00.000Z', accessEndedAt: null };

function text(over: Partial<Omit<FamilyPanelProps, 'status'>> & { status?: Partial<FamilyStatus> } = {}): string {
  const { status, ...rest } = over;
  const props: FamilyPanelProps = {
    status: { ...STATUS, ...status },
    created: null,
    confirming: null,
    busy: false,
    error: null,
    onCreate: noop,
    onShare: noop,
    onAskEnd: noop,
    onCancelEnd: noop,
    onConfirmEnd: noop,
    ...rest,
  };
  return renderToStaticMarkup(createElement(FamilyPanel, props))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('FamilyPanel: a parent', () => {
  it('explains the invite and offers Create invite link', () => {
    const t = text();
    expect(t).toContain('Invite your teen to SnapApp');
    expect(t).toContain('the teen account you approved');
    expect(t).toContain('We’ll tell them that you can see it.');
    expect(t).toContain('They won’t earn YourTal points for receipts.');
    expect(t).toContain('Create invite link');
  });

  it('offers to share the link once made, with its expiry', () => {
    const t = text({ created: { inviteId: 'i', joinUrl: 'https://snap.test/j', expiresAt: '2026-11-11T03:00:00.000Z' } });
    expect(t).toContain('It works once, and only for the teen account you approved. It expires on 11 November 2026.');
    expect(t).toContain('Share invite link');
    expect(t).not.toContain('Create invite link');
  });

  it('says when invites are off, and shows a refusal', () => {
    expect(text({ status: { invitesAvailable: false } })).toContain('Inviting a teen isn’t available yet.');
    expect(text({ error: 'You can make 10 invites a day. Try again tomorrow.' })).toContain('10 invites a day');
  });

  it('lists a teen, asks before ending access, and shows the hold after', () => {
    expect(text({ status: { teens: [TEEN] } })).toContain('Tia joined SnapApp on 1 November 2026.');
    const confirm = text({ status: { teens: [TEEN] }, confirming: 'ws-teen' });
    expect(confirm).toContain('End Tia’s access to SnapApp?');
    expect(confirm).toContain('Download anything you want to keep first.');
    const ended = text({ status: { teens: [{ ...TEEN, accessEndedAt: '2026-11-03T01:00:00.000Z' }] } });
    expect(ended).toContain('Tia’s space is kept for 30 days, then deleted.');
    expect(ended).not.toContain('End access');
  });
});

describe('FamilyPanel: a teen', () => {
  it('says who can see the space and offers nothing to invite', () => {
    const t = text({ status: { asTeen: { workspaceId: 'ws-teen', parentName: 'Pat' } } });
    expect(t).toContain('Pat. They can see your receipts, amounts and notes.');
    expect(t).not.toContain('Create invite link');
  });

  it('the notice names the parent', () => {
    expect(renderToStaticMarkup(createElement(TeenNotice, { parentName: 'Pat' }))).toContain('Pat can see this space.');
  });
});
