import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { Loading } from '@/components/form';
import { YourtalMovePromptView } from '@/components/YourtalMovePrompt';
import { Body, Card, Screen, ScreenHeader, Title } from '@/components/ui';
import { gateFor, type MailGateState } from '@/lib/mail-gate';
import { moveMismatchMessage } from '@/lib/yourtal-move';
import { runYourtalSignIn } from '@/lib/yourtal-signin';
import { useSession } from '@/session';
import { space } from '@/theme';
import { useWorkspace } from '@/workspace';
import { MailRoot } from './MailRoot';
import { ErrorBlock } from './MailUi';
import { SwitchOn } from './SwitchOn';
import { useMailStatus } from './useMailStatus';

/** A plain screen around a state: the back arrow, then the content. Mail has no frame yet. */
function Frame({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title={title} onBack={() => router.back()} />
        {children}
      </ScrollView>
    </Screen>
  );
}

/**
 * Mail lives in the person's YourTal account, so an account that has not moved to YourTal
 * gets the same "Sign in with YourTal to keep your account" prompt Settings shows, here in
 * place of Mail. "Not now" goes back.
 */
export function MailUnlinked({ onLinked }: { onLinked: () => Promise<void> | void }) {
  const router = useRouter();
  const { session, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runYourtalSignIn(
        {
          start: (input) => api().startYourtalSignIn(input),
          openBrowser: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
          finish: (input) => api().finishYourtalSignIn(input),
        },
        { signUp: false, freshSignIn: false, moveCurrentAccount: true },
      );
      if (result.kind === 'signed-in') {
        await refresh();
        await onLinked();
      } else if (result.kind === 'failed') {
        setError(
          result.code === 'yourtal_email_mismatch' ? moveMismatchMessage(session?.user.email ?? 'this account') : result.message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <YourtalMovePromptView busy={busy} error={error} onSignIn={() => void signIn()} onDismiss={() => router.back()} />
  );
}

/** The sentence and heading for each state in which Mail is not shown (`MailGateView`). */
export const GATE_COPY = {
  unavailable: {
    title: 'Mail is not available',
    body: 'Mail is not switched on for this app right now.',
  },
  notAllowed: {
    title: 'Mail is not available for this account',
    body: 'Spambank mail is for adult accounts.',
  },
  suspended: {
    title: 'Your mailbox is paused',
    body: 'Mail is switched off for this account for now. Your messages are safe. Contact support if you think this is a mistake.',
  },
  failed: {
    title: 'Mail is not available right now',
    body: 'We could not reach your mailbox. Nothing has been lost. Try again in a moment.',
  },
} as const;

/** What the person sees when there is no inbox to show, from a gate state. Pure: no data of its own. */
export function MailGateView({
  gate,
  loading,
  onRetry,
  onSwitchedOn,
  onLinked,
}: {
  gate: MailGateState | null;
  loading: boolean;
  onRetry: () => void;
  onSwitchedOn: () => void;
  onLinked: () => Promise<void> | void;
}) {
  if (gate === null) {
    if (loading) {
      return (
        <Frame title="Mail">
          <Loading />
        </Frame>
      );
    }
    return (
      <Frame title="Mail">
        <ErrorBlock message={GATE_COPY.failed.body} onRetry={onRetry} />
      </Frame>
    );
  }
  switch (gate.kind) {
    case 'unlinked':
      return (
        <Frame title="Mail">
          <MailUnlinked onLinked={onLinked} />
        </Frame>
      );
    case 'off':
      return (
        <Frame title="Mail">
          <SwitchOn onDone={onSwitchedOn} />
        </Frame>
      );
    case 'unavailable':
    case 'notAllowed':
    case 'suspended': {
      const copy = GATE_COPY[gate.kind];
      return (
        <Frame title="Mail">
          <Card style={{ gap: space.sm }}>
            <Title level="h3">{copy.title}</Title>
            <Body muted>{copy.body}</Body>
          </Card>
        </Frame>
      );
    }
    case 'on':
      return null;
  }
}

/**
 * The gate in front of every Mail screen, in the order a person meets it: not offered, not
 * signed in with YourTal, a failed read (with a retry), no mailbox yet (switch it on), a
 * paused or refused mailbox, and finally the inbox, inside one `MailRoot`.
 */
export function MailGate({ children }: { children: ReactNode }) {
  const { status, loading, refresh } = useMailStatus();
  const { active } = useWorkspace();
  const gate = status ? gateFor(status, active.teenSpace) : null;
  const props = {
    loading,
    onRetry: () => void refresh(),
    onSwitchedOn: () => void refresh(),
    onLinked: () => refresh(),
  };
  if (gate?.kind === 'on') {
    return (
      <MailRoot address={gate.address} quota={gate.quota} settings={gate.settings}>
        <View style={{ flex: 1 }}>{children}</View>
      </MailRoot>
    );
  }
  return <MailGateView gate={gate} {...props} />;
}
