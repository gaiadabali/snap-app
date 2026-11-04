import type { FamilyStatus, TeenInviteCreated } from '@snap/api-contract';
import { View } from 'react-native';

import { Body, Button, Card, Notice, Small } from '@/components/ui';
import { space } from '@/theme';

/**
 * Family (group 3.10; the words are yourtal docs/26 §3.3). Presentational:
 * the screen fetches and acts. A teen sees who can see their space; a parent
 * sees the invite explanation, the link once made, and each teen with End
 * access behind a confirm step.
 */
export interface FamilyPanelProps {
  status: FamilyStatus;
  created: TeenInviteCreated | null;
  confirming: string | null;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onShare: (url: string) => void;
  onAskEnd: (workspaceId: string) => void;
  onCancelEnd: () => void;
  onConfirmEnd: (workspaceId: string) => void;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });

export function FamilyPanel(props: FamilyPanelProps) {
  const { status, created, confirming, busy, error } = props;

  if (status.asTeen) {
    return (
      <Card>
        <View style={{ gap: space.sm }}>
          <Body strong>Who can see my space</Body>
          <Small>{status.asTeen.parentName ?? 'Your parent'}. They can see your receipts, amounts and notes.</Small>
        </View>
      </Card>
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      {error ? <Notice tone="risk">{error}</Notice> : null}
      <Card>
        <View style={{ gap: space.sm }}>
          <Body strong>Invite your teen to SnapApp</Body>
          <Small>
            Your teen can use SnapApp to keep track of their own spending. They sign in with their own YourTal account:
            the teen account you approved.
          </Small>
          <Small>• You’ll be able to see everything in their SnapApp space: receipts, amounts and notes.</Small>
          <Small>• We’ll tell them that you can see it.</Small>
          <Small>• They won’t earn YourTal points for receipts.</Small>
          <Small>• Their scans use this workspace’s credits.</Small>
          <Small>• You can end their access at any time. Ending it deletes their SnapApp space.</Small>
          {created ? (
            <>
              <Small>
                Send this link to your teen. It works once, and only for the teen account you approved. It expires on{' '}
                {day(created.expiresAt)}.
              </Small>
              <Button label="Share invite link" onPress={() => props.onShare(created.joinUrl)} />
            </>
          ) : status.invitesAvailable ? (
            <Button label="Create invite link" busy={busy} onPress={props.onCreate} />
          ) : (
            <Small>Inviting a teen isn’t available yet.</Small>
          )}
        </View>
      </Card>

      {status.teens.map((teen) => {
        const name = teen.teenName ?? 'Your teen';
        return (
          <Card key={teen.workspaceId}>
            <View style={{ gap: space.sm }}>
              <Body strong>{name}</Body>
              {teen.accessEndedAt ? (
                <Small>
                  Access ended on {day(teen.accessEndedAt)}. {name}’s space is kept for 30 days, then deleted.
                </Small>
              ) : confirming === teen.workspaceId ? (
                <>
                  <Body strong>End {name}’s access to SnapApp?</Body>
                  <Small>
                    {name} won’t be able to sign in to SnapApp, and their SnapApp space will be deleted, including their
                    receipts. Download anything you want to keep first.
                  </Small>
                  <Button label="End access" tone="risk" busy={busy} onPress={() => props.onConfirmEnd(teen.workspaceId)} />
                  <Button label="Cancel" tone="outline" disabled={busy} onPress={props.onCancelEnd} />
                </>
              ) : (
                <>
                  <Small>{name} joined SnapApp on {day(teen.joinedAt)}. Switch to their space to see it.</Small>
                  <Button label="End access" tone="outline" disabled={busy} onPress={() => props.onAskEnd(teen.workspaceId)} />
                </>
              )}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

/** Always visible in a teen's own space (docs/26 §3.3). */
export function TeenNotice({ parentName }: { parentName: string | null }) {
  return <Notice icon="users">{parentName ?? 'Your parent'} can see this space.</Notice>;
}
