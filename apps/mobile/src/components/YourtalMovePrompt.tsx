import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { Body, Button, Card, Notice, Small } from '@/components/ui';
import { MOVE_COPY, showYourtalMove, YOURTAL_MOVE_KEY } from '@/lib/yourtal-move';
import { runYourtalSignIn } from '@/lib/yourtal-signin';
import { space } from '@/theme';

/** The words and buttons, with no state of their own (`YourtalMovePrompt.test.tsx`). */
export function YourtalMovePromptView({
  busy,
  error,
  onSignIn,
  onDismiss,
}: {
  busy: boolean;
  error: string | null;
  onSignIn: () => void;
  onDismiss: () => void;
}) {
  return (
    <Card style={{ gap: space.md, padding: space.lg }}>
      <Notice tone="info" icon="info" onDismiss={onDismiss}>
        {MOVE_COPY.title}
      </Notice>
      <Body>{MOVE_COPY.body}</Body>
      {error ? <Small>{error}</Small> : null}
      <View style={{ gap: space.sm }}>
        <Button label={MOVE_COPY.action} busy={busy} onPress={onSignIn} />
        <Button label={MOVE_COPY.notNow} tone="outline" disabled={busy} onPress={onDismiss} />
      </View>
    </Card>
  );
}

/**
 * "Sign in with YourTal to keep your account" (group 3.6.e), in Settings. The
 * existing sign-in flow links the account by its verified email. Renders
 * nothing for a linked account, in a teen's space, when YourTal sign-in is off,
 * or after "Not now" (remembered on this phone).
 */
export function YourtalMovePrompt({
  yourtalLinked,
  teenSpace,
  onLinked,
}: {
  yourtalLinked: boolean | undefined;
  teenSpace: 'teen' | 'parent' | null | undefined;
  /** The account is linked now: re-read the session. */
  onLinked: () => Promise<void> | void;
}) {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(true); // hidden until the stored answer is read
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (yourtalLinked !== false) return;
    let alive = true;
    void api()
      .getYourtalSignInAvailable()
      .then((ok) => alive && setAvailable(ok))
      .catch(() => {});
    void AsyncStorage.getItem(YOURTAL_MOVE_KEY)
      .then((v) => alive && setDismissed(v === '1'))
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, [yourtalLinked]);

  if (!showYourtalMove({ yourtalLinked, teenSpace, available, dismissed })) return null;

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
        { signUp: false, freshSignIn: false },
      );
      if (result.kind === 'signed-in') await onLinked();
      else if (result.kind === 'failed') setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <YourtalMovePromptView
      busy={busy}
      error={error}
      onSignIn={() => void signIn()}
      onDismiss={() => {
        setDismissed(true);
        void AsyncStorage.setItem(YOURTAL_MOVE_KEY, '1').catch(() => {});
      }}
    />
  );
}
