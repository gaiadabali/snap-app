import type { FamilyStatus } from '@snap/api-contract';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FamilyView, TeenNotice, type FamilyViewProps } from './FamilyView';

const noop = () => {};

const STATUS: FamilyStatus = { invitesAvailable: true, teens: [], pendingInvites: [], asTeen: null };

function text(over: Partial<Omit<FamilyViewProps, 'status'>> & { status?: Partial<FamilyStatus> } = {}): string {
  const { status, ...rest } = over;
  const props: FamilyViewProps = {
    status: { ...STATUS, ...status },
    created: null,
    confirming: null,
    busy: false,
    error: null,
    onCreate: noop,
    onAskEnd: noop,
    onCancelEnd: noop,
    onConfirmEnd: noop,
    ...rest,
  };
  return renderToStaticMarkup(<FamilyView {...props} />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

const TEEN = { workspaceId: 'ws-teen', teenName: 'Tia', joinedAt: '2026-11-01T01:00:00.000Z', accessEndedAt: null };

describe('FamilyView: a parent', () => {
  it('explains the invite and offers Create invite link', () => {
    const t = text();
    expect(t).toContain('Invite your teen to SnapApp');
    expect(t).toContain('the teen account you approved');
    expect(t).toContain('see everything in their SnapApp space: receipts, amounts and notes');
    expect(t).toContain('We’ll tell them that you can see it.');
    expect(t).toContain('They won’t earn YourTal points for receipts.');
    expect(t).toContain('Their scans use this workspace’s credits.');
    expect(t).toContain('Create invite link');
  });

  it('shows the link once made, with its expiry, and no button', () => {
    const markup = renderToStaticMarkup(
      <FamilyView
        status={STATUS}
        created={{ inviteId: 'i', joinUrl: 'https://snap.test/auth/yourtal?teenInvite=abc', expiresAt: '2026-11-11T03:00:00.000Z' }}
        confirming={null}
        busy={false}
        error={null}
        onCreate={noop}
        onAskEnd={noop}
        onCancelEnd={noop}
        onConfirmEnd={noop}
      />,
    );
    expect(markup).toContain('value="https://snap.test/auth/yourtal?teenInvite=abc"');
    expect(markup).toContain('It works once, and only for the teen account you approved. It expires on 11 November 2026.');
    expect(markup).not.toContain('Create invite link');
  });

  it('says when invites are off, and shows a refusal', () => {
    expect(text({ status: { invitesAvailable: false } })).toContain('Inviting a teen isn’t available yet.');
    expect(text({ error: 'You can make 10 invites a day. Try again tomorrow.' })).toContain('You can make 10 invites a day');
  });

  it('lists a teen with End access, and asks before ending it', () => {
    expect(text({ status: { teens: [TEEN] } })).toContain('Tia joined SnapApp on 1 November 2026.');
    const confirm = text({ status: { teens: [TEEN] }, confirming: 'ws-teen' });
    expect(confirm).toContain('End Tia’s access to SnapApp?');
    expect(confirm).toContain('their SnapApp space will be deleted, including their receipts. Download anything you want to keep first.');
    expect(confirm).toContain('Cancel');
  });

  it('shows an ended teen as held for 30 days', () => {
    const t = text({ status: { teens: [{ ...TEEN, accessEndedAt: '2026-11-03T01:00:00.000Z' }] } });
    expect(t).toContain('Access ended on 3 November 2026. Tia’s space is kept for 30 days, then deleted.');
    expect(t).not.toContain('End access');
  });
});

describe('FamilyView: a teen', () => {
  it('says who can see the space, and offers nothing to invite', () => {
    const t = text({ status: { asTeen: { workspaceId: 'ws-teen', parentName: 'Pat' } } });
    expect(t).toContain('Who can see my space');
    expect(t).toContain('Pat. They can see your receipts, amounts and notes.');
    expect(t).not.toContain('Create invite link');
  });

  it('the notice in the space names the parent', () => {
    expect(renderToStaticMarkup(<TeenNotice parentName="Pat" />)).toContain('Pat can see this space.');
    expect(renderToStaticMarkup(<TeenNotice parentName={null} />)).toContain('Your parent can see this space.');
  });
});
