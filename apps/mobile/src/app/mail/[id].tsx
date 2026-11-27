import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Attachment, FolderKey } from '@snap/mail-engine';
import { useMailClient, useMessage, useSandboxDocument } from '@snap/mail-engine/react';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { Loading, Avatar } from '@/components/form';
import { AttachmentStrip } from '@/components/mail/AttachmentStrip';
import { ErrorBlock, flashNotice, useNotice } from '@/components/mail/MailUi';
import { MessageBody } from '@/components/mail/MessageBody';
import { MoveSheet } from '@/components/mail/MoveSheet';
import { UnsubscribeBar, type UnsubState } from '@/components/mail/UnsubscribeBar';
import { IconButton, Notice, Screen, Small } from '@/components/ui';
import { FOLDER_LABEL, fullAddress, fullDate, initialsOf, mailErrorMessage, senderLabel } from '@/lib/mail-format';
import { composeHref, folderHref, isMailId } from '@/lib/mail-routes';
import { saveOrShare } from '@/lib/mail-save';
import { space, type, usePalette, useTheme } from '@/theme';
import { Text } from '@/theme/text';

function ToolButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: space.md,
        borderRadius: 12,
        backgroundColor: p.surface,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={17} color={p.ink} />
      <Text style={[type.smallStrong, { color: p.ink }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A message: who, when and what, then the body. HTML is the engine's sandbox document in a
 * WebView with JavaScript off (the iframe on the web build); remote images are already
 * stripped by the server, and a link opens in the phone's browser, never in this app.
 * Opening it marks it read.
 */
export default function MessageScreen() {
  const { id: param } = useLocalSearchParams<{ id: string }>();
  const id = isMailId(param) ? param : null;
  const client = useMailClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const { scheme } = useTheme();
  const { message, loading, error } = useMessage(id);
  const html = useSandboxDocument(id, message?.hasHtml === true, { dark: scheme === 'dark' });
  const { notice, fail, clear } = useNotice();
  const [flagged, setFlagged] = useState<boolean | null>(null);
  const [plain, setPlain] = useState(false);
  const [moving, setMoving] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [unsub, setUnsub] = useState<UnsubState>({ step: 'idle' });
  const [moveToJunk, setMoveToJunk] = useState(true);

  // Opening a message reads it, once.
  const unread = message?.unread === true;
  useEffect(() => {
    if (id && unread) void client.setRead([id], true).catch(() => undefined);
  }, [client, id, unread]);

  const back = () => (router.canGoBack() ? router.back() : router.replace(folderHref('inbox') as never));

  if (id === null || (error && !message)) {
    const gone = id === null || error?.code === 'rejected';
    return (
      <Screen>
        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.gutter, gap: space.lg }}>
          <IconButton name="back" label="Back" onPress={back} style={{ marginLeft: -10 }} />
          <ErrorBlock message={gone ? 'That message is not here any more. It may have been deleted.' : mailErrorMessage(error)} />
        </View>
      </Screen>
    );
  }
  if (loading || !message) {
    return (
      <Screen>
        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.gutter }}>
          <IconButton name="back" label="Back" onPress={back} style={{ marginLeft: -10 }} />
          <Loading />
        </View>
      </Screen>
    );
  }

  const folder: FolderKey = message.folder ?? 'inbox';
  const isFlagged = flagged ?? message.flagged;
  const everyone = message.to.length + message.cc.length > 1;
  const subject = message.subject.trim() || '(no subject)';

  const leave = (text: string) => {
    flashNotice(text);
    back();
  };

  async function act(task: () => Promise<void>, done: string) {
    clear();
    try {
      await task();
      leave(done);
    } catch (e) {
      fail(mailErrorMessage(e));
    }
  }

  async function download(att: Attachment) {
    setDownloading(att.blobId);
    clear();
    try {
      await saveOrShare(await client.download(att), att);
    } catch (e) {
      fail(mailErrorMessage(e));
    } finally {
      setDownloading(null);
    }
  }

  async function unsubscribe() {
    setUnsub({ step: 'working' });
    const move = moveToJunk && folder !== 'junk' && folder !== 'spam';
    try {
      const result = await client.unsubscribe(id as string, move ? { moveToJunk: true } : undefined);
      if (result.status === 'done') setUnsub({ step: 'done', result, moved: move });
      else if (result.status === 'open_link') setUnsub({ step: 'link', url: result.url });
      else setUnsub({ step: 'failed', unavailable: result.status === 'unavailable' });
    } catch {
      setUnsub({ step: 'failed', unavailable: false });
    }
  }

  function remove() {
    if (folder !== 'trash') return void act(() => client.remove([message!.id]), 'Moved to Trash.');
    Alert.alert('Delete forever?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void act(() => client.remove([message!.id]), 'Message deleted.') },
    ]);
  }

  const showHtml = message.hasHtml && !plain && !html.error && html.doc !== null;
  const text = message.text ?? message.preview;

  return (
    <Screen>
      <View style={{ flex: 1, paddingTop: insets.top + space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.gutter - 10 }}>
          <IconButton name="back" label={`Back to ${FOLDER_LABEL[folder]}`} onPress={back} />
          <Text numberOfLines={1} style={[type.smallStrong, { flex: 1, color: p.inkMuted }]}>
            {FOLDER_LABEL[folder]}
          </Text>
          <IconButton
            name="star"
            label={isFlagged ? 'Remove star' : 'Star this message'}
            color={isFlagged ? p.warn : p.inkMuted}
            onPress={() => {
              const next = !isFlagged;
              setFlagged(next);
              void client.setFlagged([message.id], next).catch((e: unknown) => {
                setFlagged(!next);
                fail(mailErrorMessage(e));
              });
            }}
          />
          <IconButton name="trash" label={folder === 'trash' ? 'Delete forever' : 'Delete'} onPress={remove} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.gutter, paddingVertical: space.xs }}
          accessibilityLabel="Message actions"
        >
          <ToolButton icon="reply" label="Reply" onPress={() => router.push(composeHref('reply', message.id) as never)} />
          {everyone ? <ToolButton icon="replyAll" label="Reply all" onPress={() => router.push(composeHref('replyAll', message.id) as never)} /> : null}
          <ToolButton icon="forward" label="Forward" onPress={() => router.push(composeHref('forward', message.id) as never)} />
          {folder === 'spam' ? (
            <ToolButton icon="check" label="Not spam" onPress={() => void act(() => client.move([message.id], 'inbox'), 'Moved to Inbox. We will remember it is not spam.')} />
          ) : null}
          <ToolButton icon="folder" label="Move" onPress={() => setMoving(true)} />
          <ToolButton icon="mail" label="Mark unread" onPress={() => void act(() => client.setRead([message.id], false), 'Marked as unread.')} />
        </ScrollView>

        <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.sm }}>
          <Text accessibilityRole="header" selectable style={{ color: p.ink, fontSize: 20, lineHeight: 26, fontWeight: '700' }}>
            {subject}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <Avatar initials={initialsOf(message.from)} size={40} />
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text selectable numberOfLines={2} style={[type.bodyStrong, { color: p.ink }]}>
                {message.from ? fullAddress(message.from) : 'Unknown sender'}
              </Text>
              <Small numberOfLines={2}>
                To {message.to.length > 0 ? message.to.map(fullAddress).join(', ') : 'no recipients'}
              </Small>
              {message.cc.length > 0 ? <Small numberOfLines={2}>Cc {message.cc.map(fullAddress).join(', ')}</Small> : null}
              {message.replyTo.length > 0 && message.replyTo[0]?.email !== message.from?.email ? (
                <Small numberOfLines={2}>Replies go to {message.replyTo.map(fullAddress).join(', ')}</Small>
              ) : null}
              <Small>{fullDate(message.receivedAt)}</Small>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.sm }}>
          {notice ? (
            <Notice tone={notice.tone} icon={notice.tone === 'risk' ? 'alert' : 'check'} onDismiss={clear}>
              {notice.text}
            </Notice>
          ) : null}
          {message.unsubscribe ? (
            <UnsubscribeBar
              message={message}
              folder={folder}
              state={unsub}
              moveToJunk={moveToJunk}
              onToggleMove={setMoveToJunk}
              onUnsubscribe={() => void unsubscribe()}
            />
          ) : null}
          {message.hasHtml && html.error ? (
            <Notice tone="info">We could not load the formatted version of this message, so this is the plain text.</Notice>
          ) : null}
        </View>

        <View style={{ paddingTop: space.sm }}>
          <AttachmentStrip items={message.attachments} busy={downloading} onOpen={(a) => void download(a)} />
        </View>

        <View style={{ flex: 1, marginTop: space.sm, borderTopWidth: 1, borderTopColor: p.rule }}>
          {message.hasHtml && !plain && !html.error && html.doc === null ? (
            <Loading />
          ) : (
            <MessageBody doc={showHtml ? html.doc : null} text={text} title={`Message from ${senderLabel(message.from)}`} />
          )}
        </View>

        {showHtml || (message.hasHtml && plain) ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.gutter,
              paddingVertical: space.sm,
              borderTopWidth: 1,
              borderTopColor: p.rule,
            }}
          >
            {showHtml && html.remoteImagesBlocked > 0 ? (
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="shield" size={14} color={p.inkMuted} />
                <Small style={{ flex: 1, fontSize: 12 }}>
                  {html.remoteImagesBlocked} remote {html.remoteImagesBlocked === 1 ? 'image' : 'images'} blocked, so the sender cannot see when you read this.
                </Small>
              </View>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            {showHtml && message.text ? (
              <Pressable accessibilityRole="button" onPress={() => setPlain(true)} hitSlop={8}>
                <Text style={[type.smallStrong, { color: p.accentText, textDecorationLine: 'underline' }]}>View as plain text</Text>
              </Pressable>
            ) : null}
            {message.hasHtml && plain ? (
              <Pressable accessibilityRole="button" onPress={() => setPlain(false)} hitSlop={8}>
                <Text style={[type.smallStrong, { color: p.accentText, textDecorationLine: 'underline' }]}>View formatted version</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <MoveSheet
        open={moving}
        from={folder}
        count={1}
        onClose={() => setMoving(false)}
        onPick={(to) => {
          setMoving(false);
          void act(() => client.move([message.id], to), `Moved to ${FOLDER_LABEL[to]}.`);
        }}
      />
    </Screen>
  );
}
