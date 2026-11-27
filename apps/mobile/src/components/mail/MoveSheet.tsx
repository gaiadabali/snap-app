import type { FolderKey } from '@snap/mail-engine';
import { Modal, Pressable, View } from 'react-native';

import { useDeviceInsets } from '@/components/device-insets';
import { Icon, type IconName } from '@/components/Icon';
import { Body, Figure } from '@/components/ui';
import { FOLDER_LABEL } from '@/lib/mail-format';
import { FOLDER_ORDER } from '@/lib/mail-routes';
import { space, usePalette } from '@/theme';

const ICON: Record<FolderKey, IconName> = {
  inbox: 'inbox',
  spam: 'ban',
  junk: 'folder',
  sent: 'send',
  drafts: 'edit',
  trash: 'trash',
};

/**
 * "Move to…": the folders except the one the mail is in already, in a bottom sheet. Moving
 * into Spam teaches the filter ($Junk), and out of it ($NotJunk); the engine does that.
 */
export function MoveSheet({
  open,
  from,
  count,
  onClose,
  onPick,
}: {
  open: boolean;
  /** The folder the message is in; omitted for a mixed selection (search results). */
  from: FolderKey | null;
  count: number;
  onClose: () => void;
  onPick: (to: FolderKey) => void;
}) {
  const p = usePalette();
  const insets = useDeviceInsets();
  if (!open) return null;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: p.overlay }}
        />
        <View
          style={{
            backgroundColor: p.ground,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.lg,
            gap: space.sm,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.ruleStrong }} />
          <Figure size="h2">{count === 1 ? 'Move to' : `Move ${count} messages to`}</Figure>
          {FOLDER_ORDER.filter((f) => f !== from).map((f) => (
            <Pressable
              key={f}
              accessibilityRole="button"
              onPress={() => onPick(f)}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon name={ICON[f]} size={22} color={p.inkStrong} />
              <Body strong>{FOLDER_LABEL[f]}</Body>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}
