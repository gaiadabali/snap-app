import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { api, type Session } from '@/api';
import { Button } from '@/components/ui';
import { runYourtalSignIn, SIGNIN_COPY } from '@/lib/yourtal-signin';
import { space } from '@/theme';

/**
 * "Sign in with YourTal" and "Create account with YourTal" (group task 3.3.c).
 *
 * Shown only when the server says the phone client is configured
 * (`GET /v1/auth/yourtal` → `mobile`); until that answer arrives, and when it
 * is false or fails, nothing renders, so a server without YourTal looks the
 * way it did before.
 *
 * The sequence itself is `runYourtalSignIn` (`lib/yourtal-signin.ts`, tested).
 * Here it gets the real browser: `openAuthSessionAsync` opens the SYSTEM
 * browser (Custom Tabs / ASWebAuthenticationSession), never a WebView, and
 * returns the redirect URL. Nothing here logs the URL, the code or the token.
 */
export function YourtalSignInButtons({
  mode,
  onSignedIn,
  onFailure,
}: {
  mode: 'both' | 'signIn' | 'signUp';
  onSignedIn: (session: Session) => void;
  /** A refusal, as a sentence. `code` is the server's, for the screen to act on. */
  onFailure: (message: string, code: string | null) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<'signIn' | 'signUp' | null>(null);

  useEffect(() => {
    let alive = true;
    void api()
      .getYourtalSignInAvailable()
      .then((ok) => alive && setAvailable(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const go = useCallback(
    async (kind: 'signIn' | 'signUp') => {
      if (busy) return;
      setBusy(kind);
      try {
        const result = await runYourtalSignIn(
          {
            start: (input) => api().startYourtalSignIn(input),
            openBrowser: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
            finish: (input) => api().finishYourtalSignIn(input),
          },
          { signUp: kind === 'signUp' },
        );
        if (result.kind === 'signed-in') onSignedIn(result.session);
        else if (result.kind === 'failed') onFailure(result.message, result.code);
        // 'quiet': cancelled or dismissed. Back on the sign-in screen, no message.
      } finally {
        setBusy(null);
      }
    },
    [busy, onSignedIn, onFailure],
  );

  if (!available) return null;
  return (
    <View style={{ gap: space.md }}>
      {mode !== 'signUp' ? (
        <Button
          label={busy === 'signIn' ? SIGNIN_COPY.opening : SIGNIN_COPY.signIn}
          tone="outline"
          busy={busy === 'signIn'}
          disabled={busy !== null}
          onPress={() => void go('signIn')}
        />
      ) : null}
      {mode !== 'signIn' ? (
        <Button
          label={busy === 'signUp' ? SIGNIN_COPY.opening : SIGNIN_COPY.createAccount}
          tone="outline"
          busy={busy === 'signUp'}
          disabled={busy !== null}
          onPress={() => void go('signUp')}
        />
      ) : null}
    </View>
  );
}
