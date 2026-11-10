import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { api, type Session } from '@/api';
import { Button } from '@/components/ui';
import {
  finishLateReturn,
  isStaffReauth,
  isYourtalReturn,
  runYourtalSignIn,
  SIGNIN_COPY,
  type SignInAttempt,
} from '@/lib/yourtal-signin';
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
  const [busy, setBusy] = useState<Kind | null>(null);
  // Set by a `staff_reauth_required` refusal, kept through a cancelled retry: offers "Sign in again" (prompt=login at YourTal).
  const [reauth, setReauth] = useState(false);

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

  // True while any attempt (a button or a late return) runs. A ref, so the auth session's own URL event is not raced.
  const inFlight = useRef(false);

  const route = useCallback(
    (result: SignInAttempt<Session>) => {
      if (result.kind === 'signed-in') onSignedIn(result.session);
      else if (result.kind === 'failed') {
        setReauth(isStaffReauth(result.code));
        onFailure(result.message, result.code);
      }
      // 'quiet': cancelled or dismissed. Back on the sign-in screen, no message.
    },
    [onSignedIn, onFailure],
  );

  const go = useCallback(
    async (kind: Kind) => {
      if (busy || inFlight.current) return;
      inFlight.current = true;
      setBusy(kind);
      try {
        route(
          await runYourtalSignIn(
            {
              start: (input) => api().startYourtalSignIn(input),
              openBrowser: (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect),
              finish: (input) => api().finishYourtalSignIn(input),
            },
            { signUp: kind === 'signUp', freshSignIn: kind === 'fresh' },
          ),
        );
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [busy, route],
  );

  // On Android the Custom Tab can outlive an attempt reported "dismiss" (the email detour) and finish
  // later: the redirect then reaches the app with no attempt waiting (3.3.g).
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!isYourtalReturn(url) || inFlight.current) return;
      inFlight.current = true;
      setBusy('signIn');
      finishLateReturn({ finish: (input) => api().finishYourtalSignIn(input) }, url)
        .then(route)
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
          setBusy(null);
        });
    });
    return () => sub.remove();
  }, [route]);

  if (!available) return null;
  return <YourtalSignInButtonsView mode={mode} busy={busy} reauth={reauth} onGo={(kind) => void go(kind)} />;
}

export type Kind = 'signIn' | 'signUp' | 'fresh';

/** The buttons themselves, with no state of their own (`YourtalSignInButtons.test.tsx`). */
export function YourtalSignInButtonsView({
  mode,
  busy,
  reauth,
  onGo,
}: {
  mode: 'both' | 'signIn' | 'signUp';
  busy: Kind | null;
  reauth: boolean;
  onGo: (kind: Kind) => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      {mode !== 'signUp' ? (
        <Button
          label={busy === 'signIn' ? SIGNIN_COPY.opening : SIGNIN_COPY.signIn}
          tone="outline"
          busy={busy === 'signIn'}
          disabled={busy !== null}
          onPress={() => onGo('signIn')}
        />
      ) : null}
      {mode !== 'signIn' ? (
        <Button
          label={busy === 'signUp' ? SIGNIN_COPY.opening : SIGNIN_COPY.createAccount}
          tone="outline"
          busy={busy === 'signUp'}
          disabled={busy !== null}
          onPress={() => onGo('signUp')}
        />
      ) : null}
      {reauth ? (
        <Button
          label={busy === 'fresh' ? SIGNIN_COPY.opening : SIGNIN_COPY.signInAgain}
          busy={busy === 'fresh'}
          disabled={busy !== null}
          onPress={() => onGo('fresh')}
        />
      ) : null}
    </View>
  );
}
