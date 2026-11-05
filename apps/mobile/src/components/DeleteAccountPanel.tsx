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
  typed: string;
  password: string;
  busy: boolean;
  error: string | null;
  onType: (v: string) => void;
  onPassword: (v: string) => void;
  onDelete: () => void;
}

export function DeleteAccountPanel(props: DeleteAccountPanelProps) {
  const { yourtalLinked, typed, busy, error } = props;
  const ready = typed.trim() === DELETE_WORD;
  return (
    <View style={{ gap: space.lg }}>
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Notice tone="risk">{error}</Notice>
        </View>
      ) : null}

      <Card>
        <View style={{ gap: space.sm }}>
          <View accessibilityRole="header">
            <Body strong>What deleting does</Body>
          </View>
          <Small>This can’t be undone. We’ll sign you out on every device straight away, then erase:</Small>
          <Small>• your account and your sign-in;</Small>
          <Small>
            • every workspace that only you run, with its receipts and their original images, invoices, ledgers,
            statements, goals and credits. That includes receipts you may still need to keep for the ATO’s five years, so
            export what you need first;
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
            • Shared workspaces keep their records, because they belong to the business. Your name is removed from them.
            If you’re the only owner, the longest-serving manager becomes the owner. If there’s no manager, the workspace
            is deleted and its members are emailed.
          </Small>
          <Small>• A log of what our staff did to accounts, and backup copies until they age out.</Small>
        </View>
      </Card>

      {yourtalLinked ? (
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
        <Button label="Delete my account" tone="risk" busy={busy} disabled={!ready || busy} onPress={props.onDelete} />
        <Small>
          Can’t sign in, or want us to do it? Email hansel@gaiada.com, or see snap-apps.gaiada.com/delete-account.
        </Small>
      </View>
    </View>
  );
}
