import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, onSessionEnded, restoreAuthToken, type Session } from '@/api';
import { Onboarding } from '@/components/Onboarding';
import { SessionLoading, SignIn } from '@/components/SignIn';

/**
 * The gate in front of the app.
 *
 * Implemented as a component that swaps its children rather than as a router
 * redirect. A redirect-based guard has to fire after the first render, which
 * means the protected screen mounts and fetches before it is thrown away —
 * visible as a flash of somebody else's data, and a wasted round trip. Here
 * the app is simply not rendered until there is a session and somewhere to
 * put a receipt.
 *
 * Three states, in order:
 *   no session          -> sign in
 *   session, no workspace -> onboarding
 *   both                -> the app
 */

type Ctx = {
  session: Session | null;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Ctx>({
  session: null,
  signOut: async () => {},
  refresh: async () => {},
});

export function useSession(): Ctx {
  return useContext(SessionContext);
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checked, setChecked] = useState(false);
  // Why the sign-in screen is showing, when it is not the first launch.
  const [ended, setEnded] = useState<string | null>(null);

  // The server ended the session — it expired (30 days, or 14 unused), was
  // signed out elsewhere, or a password reset revoked it. The transport has
  // already forgotten the token (api/context.ts `endSession`, once per
  // token, so this cannot loop); all that is left is to show sign-in and
  // say why. Queued offline writes are kept and send after the next sign-in.
  //
  // Also fires on a cold start whose stored token has expired, which is the
  // same news for the person and deserves the same sentence.
  useEffect(
    () =>
      onSessionEnded(() => {
        setEnded('Your session has ended. Sign in again to carry on.');
        setSession(null);
      }),
    [],
  );

  const signedIn = useCallback((next: Session) => {
    setEnded(null);
    setSession(next);
  }, []);

  const refresh = useCallback(async () => {
    setSession(await api().getSession());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The stored token is loaded FIRST. Asking who is signed in while holding
    // no credential answers "nobody", and shows the sign-in screen to someone
    // who signed in last week.
    void restoreAuthToken()
      .then(() => api().getSession())
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await api().signOut();
    setSession(null);
  }, []);

  const value = useMemo<Ctx>(() => ({ session, signOut, refresh }), [session, signOut, refresh]);

  // Reading the stored session takes a moment. Rendering sign-in first and
  // then yanking it away is worse than a brief hold on the wordmark.
  if (!checked) return <SessionLoading />;

  if (!session) return <SignIn onSignedIn={signedIn} notice={ended} />;

  if (session.workspaceIds.length === 0) {
    return <Onboarding displayName={session.user.displayName} onDone={setSession} />;
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
