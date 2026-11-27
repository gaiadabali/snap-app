import type { GodConsentState } from '@snap/api-contract';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { GodConsentPromptView, GodWithdrawView } from '@/components/GodConsentParts';
import { Screen } from '@/components/ui';
import { space } from '@/theme';

/**
 * The parts of the GOD Group Privacy Notice (god/TASKS.md 9.1.d) that fetch and answer. The words
 * are in `GodConsentParts.tsx`, and they come from the server (`GET /v1/god-consent`) verbatim.
 */

/**
 * Existing accounts, on their next sign-in (mobile): Accept, or "Not now". Both are
 * recorded by the server; "Not now" is `declined`, keeps normal use, keeps the person
 * out of GOD, and is asked again only when the notice version changes. It never blocks:
 * a failed read of the state shows the app.
 */
export function GodConsentGate({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<GodConsentState | null>(null);
  const [done, setDone] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api()
      .getGodConsent()
      .then((s) => alive && setState(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (done || !state || state.prompt !== 'ask') return <>{children}</>;

  async function answer(decision: 'accepted' | 'declined') {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      await api().answerGodConsent(decision, state.notice.version);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your answer. Try again.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxl,
        }}
      >
        <GodConsentPromptView
          notice={state.notice}
          ticked={ticked}
          busy={busy}
          error={error}
          onToggle={() => setTicked((v) => !v)}
          onAccept={() => void answer('accepted')}
          onNotNow={() => void answer('declined')}
        />
      </ScrollView>
    </Screen>
  );
}

/** Shown only to someone who accepted (a teen's own account never has an acceptance of its own). */
export function GodWithdrawCard() {
  const [accepted, setAccepted] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api()
      .getGodConsent()
      .then((s) => alive && setAccepted(s.accepted))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!accepted) return null;

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await api().withdrawGodConsent();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return <GodWithdrawView busy={busy} error={error} done={done} onWithdraw={() => void withdraw()} />;
}
