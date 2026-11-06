import { View } from 'react-native';

import { Field } from '@/components/form';
import { Body, Button, Card, Notice, Small } from '@/components/ui';
import { space } from '@/theme';

/**
 * Settings → Delete account (group 8.3.a; what goes and what stays is yourtal
 * docs/29 §8, and the web page /delete-account says the same). Presentational:
 * the screen holds the text and calls the API. The typed word is the re-confirm;
 * nothing is deleted by a tap alone.
 */
export const DELETE_WORD = 'DELETE';

export interface DeleteAccountPanelProps {
  /** Signs in with YourTal: no SnapApp password to ask for, and YourTal needs its own line. */
  yourtalLinked: boolean | undefined;
  /** A teen in their own space, or a parent with a teen in SnapApp: both go through the 30-day hold (F111). */
  teenRole?: 'teen' | 'parent' | null;
  typed: string;
  password: string;
  busy: boolean;
  error: string | null;
  onType: (v: string) => void;
  onPassword: (v: string) => void;
  onDelete: () => void;
}

export function DeleteAccountPanel(props: DeleteAccountPanelProps) {
  const { yourtalLinked, teenRole, typed, busy, error } = props;
  const ready = typed.trim() === DELETE_WORD;
  return (
    <View style={{ gap: space.lg }}>
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Notice tone="risk">{error}</Notice>
        </View>
      ) : null}

      {teenRole === 'teen' ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <View accessibilityRole="header">
              <Body strong>What deleting does</Body>
            </View>
            <Small>
              This can’t be undone. Your access to SnapApp ends straight away and we sign you out on every device. Your
              space, including your receipts, is deleted within 30 days, and your parent is told. Export anything you
              want to keep first.
            </Small>
            <Small>
              If your parent invites you again before then, your space comes back as it was. After 30 days it’s gone for
              good.
            </Small>
          </View>
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ gap: space.sm }}>
              <View accessibilityRole="header">
                <Body strong>What deleting does</Body>
              </View>
              <Small>This can’t be undone. We’ll sign you out on every device straight away, then erase:</Small>
              <Small>• your account and your sign-in;</Small>
              <Small>
                • every workspace where you are the only owner or manager, even if other people use it (they’re emailed),
                with its receipts and their original images, invoices, ledgers, statements, goals and credits. That
                includes receipts you may still need to keep for the ATO’s five years, so export what you need first;
              </Small>
              <Small>• your YourTal points history in SnapApp.</Small>
            </View>
          </Card>

          <Card>
            <View style={{ gap: space.sm }}>
              <View accessibilityRole="header">
                <Body strong>What stays</Body>
              </View>
              <Small>
                • A workspace where another owner or manager remains keeps its records, because they belong to the
                business. Your name is removed from them, and the longest-serving manager becomes the owner if you were
                the only one.
              </Small>
              <Small>• A log of what our staff did to accounts, which doesn’t contain your receipts.</Small>
              <Small>
                • Backup copies, until they age out: database backups up to 30 days, stored files up to 90 days and
                off-site backup copies up to 12 months. We don’t restore a deleted account from them.
              </Small>
              <Small>
                • Receipts you already sent to Free Tax Returns, and points already added in YourTal, stay with them. Ask
                them to delete those.
              </Small>
            </View>
          </Card>
        </>
      )}

      {teenRole === 'parent' ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <View accessibilityRole="header">
              <Body strong>Your teen</Body>
            </View>
            <Small>
              Deleting your account ends your teen’s access to SnapApp first. Their space, including their receipts, is
              deleted after 30 days, and we tell them.
            </Small>
          </View>
        </Card>
      ) : null}

      {yourtalLinked && teenRole !== 'teen' ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <View accessibilityRole="header">
            <Body strong>Your YourTal account</Body>
          </View>
            <Small>
              This deletes your SnapApp account only. Your YourTal account isn’t deleted, and YourTal keeps its own
              records. To remove SnapApp from it, use Me, then Linked apps, in YourTal. If you sign in to SnapApp with
              YourTal again, you’ll start with a new, empty account.
            </Small>
          </View>
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <Field
          label={`Type ${DELETE_WORD} to confirm`}
          value={typed}
          onChangeText={props.onType}
          autoCapitalize="characters"
          autoComplete="off"
        />
        {yourtalLinked ? null : (
          <Field
            label="Your password, if your account has one"
            value={props.password}
            onChangeText={props.onPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
        )}
        <Small>
          No password (you sign in with YourTal, Google or an emailed link)? Then you must have signed in within the last
          10 minutes. If not, sign out, sign in again and come straight back here.
        </Small>
        <Button label="Delete my account" tone="risk" busy={busy} disabled={!ready || busy} onPress={props.onDelete} />
        <Small>
          Can’t sign in, or want us to do it? Email hansel@gaiada.com (we handle emailed requests within 30 days), or see snap-apps.gaiada.com/delete-account.
        </Small>
      </View>
    </View>
  );
}
