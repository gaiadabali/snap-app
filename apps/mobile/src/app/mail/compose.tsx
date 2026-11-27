import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Draft } from '@snap/mail-engine';
import { useMailClient, useMessage } from '@snap/mail-engine/react';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Loading } from '@/components/form';
import { ComposeForm } from '@/components/mail/ComposeForm';
import { ErrorBlock } from '@/components/mail/MailUi';
import { IconButton, Screen } from '@/components/ui';
import { fullDate, mailErrorMessage } from '@/lib/mail-format';
import { parseCompose } from '@/lib/mail-routes';
import { prettifyQuotedDates } from '@/lib/mail-text';
import { space } from '@/theme';

/** Loads the message a reply, forward or draft starts from, then hands a draft to the form. */
export default function ComposeScreen() {
  const params = useLocalSearchParams<{ mode?: string; id?: string }>();
  const target = useMemo(() => parseCompose(params.mode, params.id), [params.mode, params.id]);
  const client = useMailClient();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { message, loading, error } = useMessage(target === null || target.mode === 'new' ? null : target.id);

  const initial = useMemo<Draft | null>(() => {
    if (target === null) return null;
    if (target.mode === 'new') return { to: [], subject: '', text: '' };
    if (!message) return null;
    if (target.mode === 'draft') {
      const draft: Draft = { draftId: message.id, to: message.to, subject: message.subject, text: message.text ?? '' };
      if (message.cc.length > 0) draft.cc = message.cc;
      const kept = message.attachments.filter((a) => !a.inline);
      if (kept.length > 0) draft.attachments = kept;
      const parent = message.references[message.references.length - 1];
      if (parent) {
        draft.references = message.references;
        draft.inReplyTo = parent;
      }
      return draft;
    }
    const draft = client.draftFrom(message, target.mode);
    return { ...draft, text: prettifyQuotedDates(draft.text, fullDate) };
  }, [client, target, message]);

  if (target !== null && initial) {
    return <ComposeForm key={`${target.mode}-${target.id ?? 'new'}`} mode={target.mode} initial={initial} />;
  }
  return (
    <Screen>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.gutter, gap: space.lg }}>
        <IconButton name="close" label="Close" onPress={() => router.back()} style={{ marginLeft: -10 }} />
        {target === null ? (
          <ErrorBlock message="That is not a message we can reply to." />
        ) : error ? (
          <ErrorBlock
            message={error.code === 'rejected' ? 'The message you were replying to is not here any more.' : mailErrorMessage(error)}
          />
        ) : loading || !message ? (
          <Loading />
        ) : null}
      </View>
    </Screen>
  );
}
