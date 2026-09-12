import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, restoreAuthToken, type Session } from '@/api';
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

  if (!session) return <SignIn onSignedIn={setSession} />;

  if (session.workspaceIds.length === 0) {
    return <Onboarding displayName={session.user.displayName} onDone={setSession} />;
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
