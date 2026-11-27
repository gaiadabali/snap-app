import * as DocumentPicker from 'expo-document-picker';
import { useNavigation, useRouter } from 'expo-router';
import type { Attachment, Draft } from '@snap/mail-engine';
import { useMailClient } from '@snap/mail-engine/react';
import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '@/components/form';
import { Icon } from '@/components/Icon';
import { Body, Button, IconButton, Label, Notice, Screen, Small } from '@/components/ui';
import { fileSize, mailErrorMessage } from '@/lib/mail-format';
import { MAX_ATTACHMENT_BYTES, MAX_RECIPIENTS, mimeOrDefault } from '@/lib/mail-files';
import { folderHref, type ComposeMode } from '@/lib/mail-routes';
import { formatAddresses, parseAddresses } from '@/lib/mail-text';
import { radius, space, type, usePalette } from '@/theme';
import { Text, TextInput } from '@/theme/text';
import { flashNotice } from './MailUi';

const TITLE: Record<ComposeMode, string> = {
  new: 'New message',
  reply: 'Reply',
  replyAll: 'Reply all',
  forward: 'Forward',
  draft: 'Edit draft',
};

/**
 * The compose form: To, Cc and Bcc (shown on request), Subject, the message, attachments.
 * Plain text only, like the website. Send checks the addresses first and names any that are
 * not addresses; Save draft keeps it in Drafts. Leaving with unsent changes asks first.
 */
export function ComposeForm({ mode, initial }: { mode: ComposeMode; initial: Draft }) {
  const client = useMailClient();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const p = usePalette();

  const [to, setTo] = useState(formatAddresses(initial.to));
  const [cc, setCc] = useState(formatAddresses(initial.cc));
  const [bcc, setBcc] = useState(formatAddresses(initial.bcc));
  const [showCc, setShowCc] = useState((initial.cc?.length ?? 0) > 0 || (initial.bcc?.length ?? 0) > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [files, setFiles] = useState<Attachment[]>(initial.attachments ?? []);
  const [uploading, setUploading] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(initial.draftId);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'sending'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>(
    mode === 'reply' || mode === 'replyAll' ? { start: 0, end: 0 } : undefined,
  );
  // A ref as well as state: the leave guard below reads it synchronously, after a send.
  const dirty = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const touch = () => {
    dirty.current = true;
    setSaved(false);
    setProblem(null);
  };

  // Leaving with unsent changes (back button, swipe, the header arrow) asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirty.current) return;
        e.preventDefault();
        Alert.alert('Discard this message?', 'What you have written has not been sent or saved.', [
          { text: 'Keep editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              dirty.current = false;
              navigation.dispatch(e.data.action);
            },
          },
        ]);
      }),
    [navigation],
  );

  /** The draft as typed, or the reason it cannot be sent. */
  function build(forSend: boolean): { draft: Draft } | { error: string } {
    const t = parseAddresses(to);
    const c = parseAddresses(cc);
    const b = parseAddresses(bcc);
    const bad = [...t.invalid, ...c.invalid, ...b.invalid];
    if (bad.length > 0) {
      return {
        error: `${bad.length === 1 ? 'This is not an email address' : 'These are not email addresses'}: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`,
      };
    }
    if (forSend) {
      const all = new Set([...t.ok, ...c.ok, ...b.ok].map((a) => a.email.toLowerCase()));
      if (all.size === 0) return { error: 'Add at least one recipient.' };
      if (all.size > MAX_RECIPIENTS) return { error: `You can send to at most ${MAX_RECIPIENTS} people in one message.` };
    }
    const draft: Draft = { to: t.ok, subject: subject.trim(), text };
    if (c.ok.length > 0) draft.cc = c.ok;
    if (b.ok.length > 0) draft.bcc = b.ok;
    if (files.length > 0) draft.attachments = files;
    if (draftId) draft.draftId = draftId;
    if (initial.inReplyTo) draft.inReplyTo = initial.inReplyTo;
    if (initial.references) draft.references = initial.references;
    return { draft };
  }

  async function saveDraft() {
    const built = build(false);
    if ('error' in built) return setProblem(built.error);
    setPhase('saving');
    setProblem(null);
    try {
      const { draftId: id } = await client.saveDraft(built.draft);
      setDraftId(id);
      dirty.current = false;
      setSaved(true);
    } catch (e) {
      setProblem(mailErrorMessage(e));
    } finally {
      if (mounted.current) setPhase('idle');
    }
  }

  async function doSend(draft: Draft) {
    setPhase('sending');
    setProblem(null);
    try {
      await client.send(draft);
      dirty.current = false;
      flashNotice('Message sent.');
      router.replace(folderHref('sent') as never);
    } catch (err) {
      setProblem(mailErrorMessage(err));
      setPhase('idle');
    }
  }

  function send() {
    if (phase !== 'idle' || uploading.length > 0) return;
    const built = build(true);
    if ('error' in built) return setProblem(built.error);
    if (built.draft.subject === '') {
      Alert.alert('Send without a subject?', 'This message has no subject.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => void doSend(built.draft) },
      ]);
      return;
    }
    void doSend(built.draft);
  }

  async function attach() {
    setProblem(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    } catch {
      return setProblem('Could not open the file picker. Try again.');
    }
    if (picked.canceled) return;
    for (const asset of picked.assets) {
      const name = asset.name || 'attachment';
      if (typeof asset.size === 'number' && asset.size > MAX_ATTACHMENT_BYTES) {
        setProblem(`${name} is ${fileSize(asset.size)}. Attachments can be up to ${fileSize(MAX_ATTACHMENT_BYTES)} each.`);
        continue;
      }
      setUploading((u) => [...u, name]);
      try {
        const att = await client.upload(
          // The browser build gets a real File; a phone gets a path in its cache.
          asset.file
            ? { kind: 'blob', blob: asset.file, name }
            : { kind: 'uri', uri: asset.uri, name, type: mimeOrDefault(asset.mimeType) },
        );
        setFiles((f) => [...f, att]);
        touch();
      } catch (e) {
        setProblem(`${name}: ${mailErrorMessage(e)}`);
      } finally {
        setUploading((u) => {
          const at = u.indexOf(name);
          return at < 0 ? u : [...u.slice(0, at), ...u.slice(at + 1)];
        });
      }
    }
  }

  const busy = phase !== 'idle';
  const canSend = !busy && uploading.length === 0;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingTop: insets.top + space.sm,
            paddingLeft: space.gutter - 10,
            paddingRight: space.gutter,
          }}
        >
          <IconButton name="close" label="Close" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={[type.h3, { color: p.ink }]}>
              {TITLE[mode]}
            </Text>
            <Small>{phase === 'saving' ? 'Saving…' : saved ? 'Draft saved' : ' '}</Small>
          </View>
          <Button
            label={phase === 'sending' ? 'Sending…' : 'Send'}
            icon="send"
            busy={phase === 'sending'}
            disabled={!canSend}
            onPress={send}
            style={{ minHeight: 44, paddingHorizontal: space.lg }}
          />
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: space.gutter, gap: space.md, paddingBottom: space.xxl }}
        >
          <Field
            label="To"
            value={to}
            onChangeText={(v) => {
              setTo(v);
              touch();
            }}
            placeholder="name@example.com, another@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="off"
            autoFocus={mode === 'new' || mode === 'forward' || mode === 'draft'}
          />
          {showCc ? (
            <>
              <Field label="Cc" value={cc} onChangeText={(v) => { setCc(v); touch(); }} keyboardType="email-address" autoCapitalize="none" autoComplete="off" />
              <Field label="Bcc" value={bcc} onChangeText={(v) => { setBcc(v); touch(); }} keyboardType="email-address" autoCapitalize="none" autoComplete="off" />
            </>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setShowCc(true)} hitSlop={8} style={{ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center' }}>
              <Text style={[type.smallStrong, { color: p.accentText }]}>Add Cc / Bcc</Text>
            </Pressable>
          )}
          <Field label="Subject" value={subject} onChangeText={(v) => { setSubject(v); touch(); }} autoComplete="off" />

          <View style={{ gap: 6 }}>
            <Label>Message</Label>
            <TextInput
              accessibilityLabel="Message"
              value={text}
              onChangeText={(v) => {
                setText(v);
                touch();
              }}
              multiline
              autoFocus={mode === 'reply' || mode === 'replyAll'}
              // A reply starts typing above the quote: the caret is held at the top once, then released.
              selection={caret}
              onSelectionChange={() => setCaret(undefined)}
              placeholderTextColor={p.inkFaint}
              style={[
                type.body,
                {
                  color: p.ink,
                  minHeight: 240,
                  textAlignVertical: 'top',
                  padding: 14,
                  borderWidth: 1.5,
                  borderColor: p.ruleStrong,
                  borderRadius: radius.lg,
                  backgroundColor: p.card,
                },
              ]}
            />
          </View>

          {files.length > 0 || uploading.length > 0 ? (
            <View accessibilityLabel="Attachments" style={{ gap: space.sm }}>
              {files.map((f, i) => (
                <View
                  key={`${f.blobId}-${i}`}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    minHeight: 48,
                    paddingLeft: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: p.ruleStrong,
                  }}
                >
                  <Icon name="paperclip" size={16} color={p.inkMuted} />
                  <Text numberOfLines={1} style={[type.smallStrong, { flex: 1, color: p.ink }]}>
                    {f.name}
                  </Text>
                  <Small>{fileSize(f.size)}</Small>
                  <IconButton
                    name="close"
                    label={`Remove ${f.name}`}
                    size={17}
                    onPress={() => {
                      setFiles((cur) => cur.filter((_, at) => at !== i));
                      touch();
                    }}
                  />
                </View>
              ))}
              {uploading.map((name, i) => (
                <View
                  key={`up-${name}-${i}`}
                  style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: p.ruleStrong }}
                >
                  <Small numberOfLines={1}>Uploading {name}…</Small>
                </View>
              ))}
            </View>
          ) : null}

          {problem ? (
            <Notice tone="risk" icon="alert">
              {problem}
            </Notice>
          ) : null}

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Attach files" tone="outline" icon="paperclip" onPress={() => void attach()} style={{ flex: 1 }} />
            <Button label="Save draft" tone="outline" disabled={busy} busy={phase === 'saving'} onPress={() => void saveDraft()} style={{ flex: 1 }} />
          </View>
          <Body muted style={{ fontSize: 12, lineHeight: 17 }}>
            Up to {MAX_RECIPIENTS} recipients and {fileSize(MAX_ATTACHMENT_BYTES)} per attachment.
          </Body>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
