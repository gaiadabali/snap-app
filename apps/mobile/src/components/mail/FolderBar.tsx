import type { Folder, FolderKey } from '@snap/mail-engine';
import { Pressable, ScrollView, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { FOLDER_LABEL, countLabel } from '@/lib/mail-format';
import { FOLDER_ORDER } from '@/lib/mail-routes';
import { Text } from '@/theme/text';
import { radius, space, type, usePalette } from '@/theme';

const FOLDER_ICON: Record<FolderKey, IconName> = {
  inbox: 'inbox',
  spam: 'ban',
  junk: 'folder',
  sent: 'send',
  drafts: 'edit',
  trash: 'trash',
};

/** Unread for the folders you read; the total for Drafts; nothing for Sent and Trash. */
export function folderCount(folder: Folder | undefined): number {
  if (!folder) return 0;
  if (folder.key === 'inbox' || folder.key === 'spam' || folder.key === 'junk') return folder.unread;
  if (folder.key === 'drafts') return folder.total;
  return 0;
}

/**
 * The six folders as a row of chips that scrolls sideways, with the open one filled. A
 * count sits on a chip when there is something to say: unread mail, or drafts waiting.
 */
export function FolderBar({
  folders,
  active,
  onSelect,
}: {
  folders: Folder[];
  active: FolderKey | null;
  onSelect: (key: FolderKey) => void;
}) {
  const p = usePalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Mail folders"
      // A horizontal ScrollView grows to fill a column on the web build; the chips set the height.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.gutter }}
    >
      {FOLDER_ORDER.map((key) => {
        const count = folderCount(folders.find((f) => f.key === key));
        const on = active === key;
        const fg = on ? p.accentInk : p.inkMuted;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            aria-selected={on}
            accessibilityLabel={`${FOLDER_LABEL[key]}${count > 0 ? (key === 'drafts' ? `, ${count} draft${count === 1 ? '' : 's'}` : `, ${count} unread`) : ''}`}
            onPress={() => onSelect(key)}
            style={({ pressed }) => ({
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: space.md,
              borderRadius: radius.pill,
              backgroundColor: on ? p.accent : p.surface,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name={FOLDER_ICON[key]} size={17} color={fg} />
            <Text style={[type.smallStrong, { color: on ? p.accentInk : p.ink }]}>{FOLDER_LABEL[key]}</Text>
            {count > 0 ? (
              <View
                style={{
                  minWidth: 20,
                  paddingHorizontal: 6,
                  height: 20,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? 'rgba(255,255,255,0.28)' : key === 'drafts' ? p.surfaceAlt : p.accent,
                }}
              >
                <Text
                  style={[
                    type.smallStrong,
                    { fontSize: 11, lineHeight: 14, color: on || key !== 'drafts' ? p.accentInk : p.inkMuted },
                  ]}
                >
                  {countLabel(count)}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
