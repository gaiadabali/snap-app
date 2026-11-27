import type { MessageSummary } from '@snap/mail-engine';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { FOLDER_LABEL, listDate, recipientsLabel, senderLabel } from '@/lib/mail-format';
import { Text } from '@/theme/text';
import { radius, space, type, usePalette } from '@/theme';

/**
 * One line of a message list. A tap opens the message; a long press starts selecting; the
 * star is its own button, so a tap on it never opens the message.
 *
 * In Sent and Drafts the "who" is the recipients, not the sender (who is always you).
 * While selecting, a tap toggles instead of opening.
 */
export function MessageRow({
  message,
  selected,
  selecting,
  showFolder = false,
  onOpen,
  onToggle,
  onFlag,
  now,
}: {
  message: MessageSummary;
  selected: boolean;
  selecting: boolean;
  /** Search results span folders, so they say which one each hit is in. */
  showFolder?: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onFlag: (next: boolean) => void;
  now?: Date;
}) {
  const p = usePalette();
  const outgoing = message.folder === 'sent' || message.folder === 'drafts';
  const who = outgoing ? `To: ${recipientsLabel(message.to)}` : senderLabel(message.from);
  const subject = message.subject.trim() || '(no subject)';
  const when = listDate(message.receivedAt, now);
  const label = [
    message.unread ? 'Unread' : null,
    who,
    subject,
    when,
    message.hasAttachment ? 'has attachments' : null,
    message.flagged ? 'starred' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View
      testID="mail-row"
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        backgroundColor: selected ? p.accentSoft : 'transparent',
        borderRadius: radius.md,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        aria-selected={selected}
        accessibilityHint={selecting ? 'Selects or clears this message' : 'Opens the message. Press and hold to select.'}
        onPress={selecting ? onToggle : onOpen}
        onLongPress={onToggle}
        delayLongPress={350}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 72,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingLeft: space.gutter,
          paddingVertical: space.md,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        {selecting ? (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: selected ? p.accent : p.ruleStrong,
              backgroundColor: selected ? p.accent : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected ? <Icon name="check" size={15} color={p.accentInk} /> : null}
          </View>
        ) : (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: message.unread ? p.accent : 'transparent',
            }}
          />
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
            <Text
              numberOfLines={1}
              style={[type.bodyStrong, { flex: 1, color: message.unread ? p.ink : p.inkStrong, fontWeight: message.unread ? '700' : '500' }]}
            >
              {who}
            </Text>
            <Text style={[type.small, { color: message.unread ? p.accentText : p.inkMuted }]}>{when}</Text>
          </View>
          <Text numberOfLines={1} style={[type.body, { color: message.unread ? p.ink : p.inkStrong, fontWeight: message.unread ? '600' : '400' }]}>
            {subject}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text numberOfLines={1} style={[type.small, { flex: 1, color: p.inkMuted }]}>
              {message.preview || ' '}
            </Text>
            {showFolder && message.folder ? (
              <Text style={[type.smallStrong, { color: p.inkMuted, backgroundColor: p.surfaceAlt, paddingHorizontal: 7, borderRadius: 6, overflow: 'hidden' }]}>
                {FOLDER_LABEL[message.folder]}
              </Text>
            ) : null}
            {message.hasAttachment ? <Icon name="paperclip" size={15} color={p.inkMuted} /> : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={message.flagged ? 'Remove star' : 'Star this message'}
        aria-pressed={message.flagged}
        onPress={() => onFlag(!message.flagged)}
        hitSlop={4}
        style={{ width: 48, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="star" size={20} color={message.flagged ? p.warn : p.inkFaint} />
      </Pressable>
    </View>
  );
}
