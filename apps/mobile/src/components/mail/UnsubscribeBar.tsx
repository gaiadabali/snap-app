import type { FolderKey, MessageDetail, UnsubscribeResult } from '@snap/mail-engine';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Body, Button, Card, Notice, Small } from '@/components/ui';
import { senderLabel } from '@/lib/mail-format';
import { space, usePalette } from '@/theme';
import { isOpenableLink, openOutside } from './MessageText';

export type UnsubState =
  | { step: 'idle' }
  | { step: 'working' }
  | { step: 'done'; result: Extract<UnsubscribeResult, { status: 'done' }>; moved: boolean }
  | { step: 'link'; url: string }
  | { step: 'failed'; unavailable: boolean };

/** Only a plain https link is offered as a way out; the server has already vetted it. */
function httpsOnly(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' && isOpenableLink(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * One-tap unsubscribe for a message that came from a mailing list. The server does the
 * work (RFC 8058 one-click, or a `mailto:` sent from the person's own mailbox); when the
 * sender only offers a web page, the link opens in the browser.
 */
export function UnsubscribeBar({
  message,
  folder,
  state,
  moveToJunk,
  onToggleMove,
  onUnsubscribe,
}: {
  message: Pick<MessageDetail, 'from'>;
  folder: FolderKey;
  state: UnsubState;
  moveToJunk: boolean;
  onToggleMove: (next: boolean) => void;
  onUnsubscribe: () => void;
}) {
  const p = usePalette();
  const who = senderLabel(message.from);
  const canMove = folder !== 'junk' && folder !== 'spam';

  if (state.step === 'done') {
    return (
      <Notice tone="good" icon="check">
        Unsubscribed. {who} has been told to stop. It can take a few days to take effect.
        {state.moved ? ' This message has been moved to Junk.' : ''}
      </Notice>
    );
  }
  if (state.step === 'link') {
    const href = httpsOnly(state.url);
    return (
      <Card tone="warn" style={{ gap: space.sm }}>
        <Body>{who} needs you to finish unsubscribing on their website.</Body>
        {href ? (
          <Button label="Open the unsubscribe page" tone="outline" icon="forward" onPress={() => openOutside(href)} />
        ) : (
          <Small>The link they gave us is not safe to open, so it has been left out.</Small>
        )}
      </Card>
    );
  }
  return (
    <Card tone="ground" bordered style={{ gap: space.sm }}>
      <Body>This looks like a mailing list. Stop mail from {who}.</Body>
      {canMove ? (
        <Pressable
          accessibilityRole="checkbox"
          aria-checked={moveToJunk}
          onPress={() => onToggleMove(!moveToJunk)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: moveToJunk ? p.accent : p.ruleStrong,
              backgroundColor: moveToJunk ? p.accent : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {moveToJunk ? <Icon name="check" size={14} color={p.accentInk} /> : null}
          </View>
          <Small style={{ flex: 1 }}>Also move this message to Junk</Small>
        </Pressable>
      ) : null}
      {state.step === 'failed' ? (
        <Small style={{ color: p.risk }}>
          {state.unavailable
            ? 'This sender does not offer a way to unsubscribe from here.'
            : 'That did not go through. Try again, or use the link in the message.'}
        </Small>
      ) : null}
      <Button
        label={state.step === 'working' ? 'Unsubscribing…' : 'Unsubscribe'}
        tone="outline"
        busy={state.step === 'working'}
        onPress={onUnsubscribe}
      />
    </Card>
  );
}
