import type { FamilyStatus, TeenInviteCreated } from '@snap/api-contract';

import { Button, Card, Input } from '@/design/primitives';

/**
 * Family (group 3.10; the words are yourtal docs/26 §3.3). Presentational:
 * everything comes in as props, so each state is tested from markup alone.
 *
 *   - a teen sees who can see their space, and nothing to invite;
 *   - a parent sees the invite explanation and [Create invite link], the
 *     link once made, and each teen with [End access] behind a confirm step.
 */
export type FamilyViewProps = {
  status: FamilyStatus;
  /** The invite just made: its link is shown once. */
  created: TeenInviteCreated | null;
  /** The teen space whose End access is being confirmed. */
  confirming: string | null;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onAskEnd: (workspaceId: string) => void;
  onCancelEnd: () => void;
  onConfirmEnd: (workspaceId: string) => void;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });

export function FamilyView(props: FamilyViewProps) {
  const { status, created, confirming, busy, error } = props;

  if (status.asTeen) {
    const parent = status.asTeen.parentName ?? 'Your parent';
    return (
      <Card>
        <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">Who can see my space</h2>
        <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">
          {parent}. They can see your receipts, amounts and notes.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p role="alert" className="text-[14px] text-[var(--color-risk)]">
          {error}
        </p>
      ) : null}

      <Card>
        <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">Invite your teen to SnapApp</h2>
        <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">
          Your teen can use SnapApp to keep track of their own spending. They sign in with their own YourTal account:
          the teen account you approved.
        </p>
        <ul className="mt-3 list-disc pl-5 text-[14px] text-[var(--color-ink-muted)]">
          <li>You’ll be able to see everything in their SnapApp space: receipts, amounts and notes.</li>
          <li>We’ll tell them that you can see it.</li>
          <li>They won’t earn YourTal points for receipts.</li>
          <li>Their scans use this workspace’s credits.</li>
          <li>You can end their access at any time. Ending it deletes their SnapApp space.</li>
        </ul>
        {created ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-[14px] text-[var(--color-ink)]">
              Send this link to your teen. It works once, and only for the teen account you approved. It expires on{' '}
              {day(created.expiresAt)}.
            </p>
            <Input readOnly value={created.joinUrl} aria-label="Invite link" />
          </div>
        ) : status.invitesAvailable ? (
          <div className="mt-4">
            <Button onClick={props.onCreate} disabled={busy}>
              Create invite link
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-[14px] text-[var(--color-ink-muted)]">Inviting a teen isn’t available yet.</p>
        )}
      </Card>

      {status.teens.map((teen) => {
        const name = teen.teenName ?? 'Your teen';
        return (
          <Card key={teen.workspaceId}>
            <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">{name}</h2>
            {teen.accessEndedAt ? (
              <p className="mt-2 text-[14px] text-[var(--color-ink-muted)]">
                Access ended on {day(teen.accessEndedAt)}. {name}’s space is kept for 30 days, then deleted.
              </p>
            ) : confirming === teen.workspaceId ? (
              <div className="mt-2 flex flex-col gap-3">
                <p className="text-[15px] font-semibold text-[var(--color-ink)]">End {name}’s access to SnapApp?</p>
                <p className="text-[14px] text-[var(--color-ink-muted)]">
                  {name} won’t be able to sign in to SnapApp, and their SnapApp space will be deleted, including their
                  receipts. Download anything you want to keep first.
                </p>
                <div className="flex gap-2">
                  <Button variant="danger" onClick={() => props.onConfirmEnd(teen.workspaceId)} disabled={busy}>
                    End access
                  </Button>
                  <Button variant="secondary" onClick={props.onCancelEnd} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                <p className="text-[14px] text-[var(--color-ink-muted)]">
                  {name} joined SnapApp on {day(teen.joinedAt)}. Switch to their space to see it.
                </p>
                <div>
                  <Button variant="secondary" onClick={() => props.onAskEnd(teen.workspaceId)} disabled={busy}>
                    End access
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** Always visible in a teen's own space (docs/26 §3.3). */
export function TeenNotice({ parentName }: { parentName: string | null }) {
  return (
    <p role="note" className="rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] px-4 py-2 text-[14px] text-[var(--color-ink)]">
      {parentName ?? 'Your parent'} can see this space.
    </p>
  );
}
