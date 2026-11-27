import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFolders } from '@snap/mail-engine/react';
import type { FolderKey } from '@snap/mail-engine';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { FolderBar } from '@/components/mail/FolderBar';
import { useMailAccount } from '@/components/mail/MailRoot';
import { MessageList } from '@/components/mail/MessageList';
import { CopyButton } from '@/components/mail/CopyButton';
import { SearchBar } from '@/components/SearchBar';
import { IconButton, Screen, ScreenHeader, Small } from '@/components/ui';
import { composeHref, parseFolder, parseSearch, settingsHref } from '@/lib/mail-routes';
import { shadow, space, usePalette } from '@/theme';
import { Text } from '@/theme/text';

/** The text, once the person has stopped typing for a moment. */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

/**
 * Mail: the folders along the top, the list of the open one, search, and a pencil to write.
 * The open folder and the search live in the URL (`?folder=`, `?q=`), so coming back from a
 * message lands where the person was.
 */
export default function MailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const params = useLocalSearchParams<{ folder?: string; q?: string }>();
  const { address } = useMailAccount();
  const { folders } = useFolders();

  const folder = parseFolder(params.folder);
  const urlSearch = parseSearch(params.q);
  const [searching, setSearching] = useState(urlSearch !== '');
  const [text, setText] = useState(urlSearch);
  const query = useDebounced(text.trim(), 400);
  const activeSearch = searching && query !== '' ? query.slice(0, 200) : null;
  // The pencil gives way to the selection bar, which sits where it would be.
  const [selecting, setSelecting] = useState(false);

  const select = (key: FolderKey) => {
    setSearching(false);
    setText('');
    router.setParams({ folder: key === 'inbox' ? undefined : key, q: undefined });
  };

  return (
    <Screen>
      <View style={{ paddingTop: insets.top + space.md, gap: space.md, flex: 1 }}>
        <View style={{ paddingHorizontal: space.gutter, gap: 2 }}>
          <ScreenHeader
            title="Mail"
            onBack={() => router.back()}
            trailing={
              <View style={{ flexDirection: 'row' }}>
                <IconButton
                  name="search"
                  label={searching ? 'Close search' : 'Search mail'}
                  onPress={() => {
                    setSearching((s) => !s);
                    setText('');
                  }}
                />
                <IconButton name="key" label="Mail settings" onPress={() => router.push(settingsHref() as never)} />
              </View>
            }
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text selectable numberOfLines={1} testID="mail-address" style={{ flex: 1, color: p.inkMuted, fontSize: 13, lineHeight: 19 }}>
              {address}
            </Text>
            <CopyButton text={address} label="Copy your address" />
          </View>
        </View>

        {searching ? (
          <View style={{ paddingHorizontal: space.gutter }}>
            <SearchBar value={text} onChangeText={setText} placeholder="Search mail" />
          </View>
        ) : null}

        <FolderBar folders={folders} active={activeSearch ? null : folder} onSelect={select} />

        <View style={{ flex: 1 }}>
          {activeSearch ? (
            <MessageList key={`q:${activeSearch}`} search={activeSearch} onSelectingChange={setSelecting} />
          ) : searching ? (
            <View style={{ paddingHorizontal: space.gutter }}>
              <Small>Type a sender’s name or a word from the subject.</Small>
            </View>
          ) : (
            <MessageList key={`f:${folder}`} folder={folder} onSelectingChange={setSelecting} />
          )}
        </View>
      </View>

      {selecting ? null : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Write a new message"
        onPress={() => router.push(composeHref() as never)}
        style={({ pressed }) => [
          {
            position: 'absolute',
            right: space.gutter,
            bottom: space.lg,
            width: 56,
            height: 56,
            borderRadius: 18,
            backgroundColor: p.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          },
          shadow.card,
        ]}
      >
        <Icon name="edit" size={24} color={p.accentInk} />
      </Pressable>
      )}
    </Screen>
  );
}
