import type { Attachment } from '@snap/mail-engine';
import { ActivityIndicator, Pressable, ScrollView } from 'react-native';

import { Icon } from '@/components/Icon';
import { fileSize } from '@/lib/mail-format';
import { Text } from '@/theme/text';
import { radius, space, type, usePalette } from '@/theme';

/**
 * A message's attachments as a row of chips that scrolls sideways. A tap downloads the file
 * and offers it to the share sheet. Inline images (the ones the message body uses itself)
 * are not listed.
 */
export function AttachmentStrip({
  items,
  busy,
  onOpen,
}: {
  items: Attachment[];
  /** The blob id being downloaded now, if any. */
  busy: string | null;
  onOpen: (a: Attachment) => void;
}) {
  const p = usePalette();
  const shown = items.filter((a) => !a.inline);
  if (shown.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={`${shown.length} ${shown.length === 1 ? 'attachment' : 'attachments'}`}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.gutter }}
      style={{ flexGrow: 0 }}
    >
      {shown.map((a) => (
        <Pressable
          key={a.blobId}
          accessibilityRole="button"
          accessibilityLabel={`Save ${a.name} (${fileSize(a.size)})`}
          aria-busy={busy === a.blobId}
          aria-disabled={busy !== null}
          onPress={busy === null ? () => onOpen(a) : undefined}
          style={({ pressed }) => ({
            minHeight: 44,
            maxWidth: 260,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.ruleStrong,
            opacity: pressed || (busy !== null && busy !== a.blobId) ? 0.6 : 1,
          })}
        >
          {busy === a.blobId ? <ActivityIndicator size="small" color={p.accent} /> : <Icon name="paperclip" size={16} color={p.inkMuted} />}
          <Text numberOfLines={1} style={[type.smallStrong, { color: p.ink, flexShrink: 1 }]}>
            {a.name}
          </Text>
          <Text style={[type.small, { color: p.inkMuted }]}>{fileSize(a.size)}</Text>
          <Icon name="download" size={16} color={p.inkMuted} />
        </Pressable>
      ))}
    </ScrollView>
  );
}
