import { useFocusEffect, useRouter } from 'expo-router';
import type { FolderKey, MessageSummary } from '@snap/mail-engine';
import { useMailClient, useMessageList } from '@snap/mail-engine/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, FlatList, Platform, Pressable, RefreshControl, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Empty, Loading } from '@/components/form';
import { Button, Notice, Small } from '@/components/ui';
import { FOLDER_EMPTY, FOLDER_HINT, FOLDER_LABEL, mailErrorMessage } from '@/lib/mail-format';
import { composeHref, messageHref } from '@/lib/mail-routes';
import { space, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { MessageRow } from './MessageRow';
import { MoveSheet } from './MoveSheet';
import { ErrorBlock, consumeFlash, useNotice } from './MailUi';
import { SpamBanner } from './SpamBanner';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function ActionButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={!!disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 56,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={22} color={p.ink} />
      <Text style={{ color: p.inkStrong, fontSize: 11, lineHeight: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * A folder, or search results. One component so both share selection, bulk actions and
 * paging. A long press starts selecting; the bar at the bottom then marks, moves or deletes
 * what is selected, and the system back button leaves selecting before it leaves Mail.
 */
export function MessageList({
  folder,
  search,
  onSelectingChange,
}: {
  folder?: FolderKey;
  search?: string;
  /** Tells the screen when selecting starts and stops, so it can move the pencil out of the way. */
  onSelectingChange?: (selecting: boolean) => void;
}) {
  const client = useMailClient();
  const router = useRouter();
  const p = usePalette();
  const source = useMemo(() => (folder ? folder : { search: search ?? '' }), [folder, search]);
  const list = useMessageList(source);
  const { notice, say, fail, clear } = useNotice();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const inTrash = folder === 'trash';
  const ids = useMemo(() => new Set(list.items.map((m) => m.id)), [list.items]);
  // Forget anything that is no longer in the list (moved, deleted, refreshed away).
  const chosen = useMemo(() => [...selected].filter((id) => ids.has(id)), [selected, ids]);
  const selecting = chosen.length > 0;
  useEffect(() => {
    onSelectingChange?.(selecting);
    return () => onSelectingChange?.(false);
  }, [selecting, onSelectingChange]);

  useEffect(() => {
    // A new folder or query starts with nothing selected.
    setSelected(new Set());
    setMoving(false);
  }, [folder, search]);

  // Coming back from a message or compose screen: show what changed there. `refresh` changes
  // identity on every load, so it is read through a ref: depending on it would refresh, load,
  // get a new `refresh` and refresh again, for ever.
  const refreshRef = useRef(list.refresh);
  refreshRef.current = list.refresh;
  const sayRef = useRef(say);
  sayRef.current = say;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      refreshRef.current();
      // "Moved to Spam." from the reader: this list stayed mounted under it, so it takes the message now.
      const flash = consumeFlash();
      if (flash) sayRef.current(flash);
    }, []),
  );

  // The system back button leaves selecting first.
  useEffect(() => {
    // BackHandler is Android's; the browser build has no hardware back button and warns if asked.
    if (!selecting || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelected(new Set());
      return true;
    });
    return () => sub.remove();
  }, [selecting]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function run(task: () => Promise<void>, done: string) {
    setBusy(true);
    clear();
    try {
      await task();
      say(done);
      setSelected(new Set());
    } catch (e) {
      fail(mailErrorMessage(e));
    } finally {
      list.refresh();
      setBusy(false);
    }
  }

  const count = chosen.length;
  const noun = plural(count, 'message', 'messages');

  const deleteChosen = () => {
    if (!inTrash) return void run(() => client.remove(chosen), `Moved ${count} ${noun} to Trash.`);
    Alert.alert(`Delete ${count} ${noun} forever?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete forever', style: 'destructive', onPress: () => void run(() => client.remove(chosen), `Deleted ${count} ${noun}.`) },
    ]);
  };

  const title = folder ? FOLDER_LABEL[folder] : 'Search results';
  const hint = folder ? FOLDER_HINT[folder] : search ? `Matches for “${search}” across every folder.` : undefined;

  const header = (
    <View style={{ gap: space.md, paddingHorizontal: space.gutter, paddingBottom: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text accessibilityRole="header" style={{ color: p.ink, fontSize: 18, lineHeight: 24, fontWeight: '700' }}>
          {title}
          {list.total > 0 ? <Text style={{ color: p.inkMuted, fontSize: 13, fontWeight: '400' }}>{`  ${list.total}`}</Text> : null}
        </Text>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      {folder === 'spam' ? <SpamBanner /> : null}
      {notice ? (
        <Notice tone={notice.tone} icon={notice.tone === 'risk' ? 'alert' : 'check'} onDismiss={clear}>
          {notice.text}
        </Notice>
      ) : null}
      {list.error && list.items.length > 0 ? (
        <Notice tone="risk" icon="alert">
          {mailErrorMessage(list.error)}
        </Notice>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      {list.error && list.items.length === 0 ? (
        <View style={{ padding: space.gutter }}>
          <ErrorBlock message={mailErrorMessage(list.error)} onRetry={() => list.refresh()} />
        </View>
      ) : (
        <FlatList<MessageSummary>
          data={list.items}
          keyExtractor={(m) => m.id}
          ListHeaderComponent={header}
          ListEmptyComponent={
            list.loading ? (
              <Loading />
            ) : (
              <View style={{ paddingHorizontal: space.gutter }}>
                <Empty
                  title={folder ? FOLDER_EMPTY[folder] : search ? `Nothing found for “${search}”.` : 'Type something to search your mail.'}
                  detail={
                    folder === 'sent' || folder === 'drafts'
                      ? 'Tap the pencil to write a message.'
                      : !folder && search
                        ? 'Try a sender’s name or a word from the subject.'
                        : ' '
                  }
                />
              </View>
            )
          }
          renderItem={({ item }) => (
            <MessageRow
              message={item}
              selected={selected.has(item.id)}
              selecting={selecting}
              showFolder={!folder}
              onOpen={() => router.push((item.folder === 'drafts' ? composeHref('draft', item.id) : messageHref(item.id)) as never)}
              onToggle={() => toggle(item.id)}
              onFlag={(on) =>
                void client.setFlagged([item.id], on).then(
                  () => list.refresh(),
                  (e: unknown) => fail(mailErrorMessage(e)),
                )
              }
            />
          )}
          onEndReached={() => {
            if (list.items.length < list.total && !list.loading) list.loadMore();
          }}
          onEndReachedThreshold={0.5}
          refreshControl={<RefreshControl refreshing={list.loading && list.items.length > 0} onRefresh={() => list.refresh()} />}
          ListFooterComponent={
            list.items.length < list.total ? (
              <View style={{ paddingVertical: space.lg, alignItems: 'center', gap: space.sm }}>
                <Small>
                  Showing {list.items.length} of {list.total}
                </Small>
                <Button label="Show more" tone="outline" onPress={() => list.loadMore()} disabled={list.loading} />
              </View>
            ) : (
              <View style={{ height: space.xxxl + space.xxl }} />
            )
          }
          contentContainerStyle={{ paddingTop: space.xs }}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {selecting ? (
        <View
          accessibilityRole="toolbar"
          accessibilityLabel={`Actions for ${count} selected ${noun}`}
          style={{
            flexDirection: 'row',
            backgroundColor: p.card,
            borderTopWidth: 1,
            borderTopColor: p.rule,
            paddingHorizontal: space.sm,
          }}
        >
          <ActionButton icon="close" label={`${count} selected`} onPress={() => setSelected(new Set())} />
          <ActionButton icon="check" label="Read" disabled={busy} onPress={() => void run(() => client.setRead(chosen, true), `Marked ${count} ${noun} as read.`)} />
          <ActionButton icon="mail" label="Unread" disabled={busy} onPress={() => void run(() => client.setRead(chosen, false), `Marked ${count} ${noun} as unread.`)} />
          <ActionButton icon="folder" label="Move" disabled={busy} onPress={() => setMoving(true)} />
          <ActionButton icon="trash" label={inTrash ? 'Delete' : 'Trash'} disabled={busy} onPress={deleteChosen} />
        </View>
      ) : null}

      <MoveSheet
        open={moving}
        from={folder ?? null}
        count={count}
        onClose={() => setMoving(false)}
        onPick={(to) => {
          setMoving(false);
          void run(() => client.move(chosen, to), `Moved ${count} ${noun} to ${FOLDER_LABEL[to]}.`);
        }}
      />
    </View>
  );
}
