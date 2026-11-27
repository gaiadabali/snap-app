import type { GodConsentState } from '@snap/api-contract';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { Icon } from '@/components/Icon';
import { Body, Button, Card, Notice, Screen, Small, Title } from '@/components/ui';
import { control, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

/**
 * The GOD Group Privacy Notice on the phone (god/TASKS.md 9.1.d). The two
 * sentences come from the server (`GET /v1/god-consent`), verbatim: this file
 * never types them, so the phone and the web cannot drift apart.
 *
 *   - `GodNoticeBox`        the unticked box a NEW sign-up must tick (Onboarding)
 *   - `GodConsentGate`      an EXISTING account's next sign-in: Accept or "Not now"
 *   - `GodWithdrawCard`     "Stop combining my data with GOD" (Settings, Delete account)
 *   - `GuardianConsentBox`  a parent's tick for their teen (Family)
 */

export const ADULT_LINK_TEXT = 'GOD Group Privacy Notice';
export const GUARDIAN_LINK_TEXT = 'GOD Group Privacy Notice for teens';

/** The sentence verbatim, with the notice's name as a link. Opens in the browser, so the form is not lost. */
export function NoticeText({ text, linkText, href }: { text: string; linkText: string; href: string }): ReactNode {
  const p = usePalette();
  const at = text.indexOf(linkText);
  if (at < 0) return <Text style={[type.small, { color: p.inkStrong }]}>{text}</Text>;
  return (
    <Text style={[type.small, { color: p.inkStrong }]}>
      {text.slice(0, at)}
      <Text
        accessibilityRole="link"
        onPress={() => void Linking.openURL(href)}
        style={{ color: p.accent, textDecorationLine: 'underline', fontWeight: '600' }}
      >
        {linkText}
      </Text>
      {text.slice(at + linkText.length)}
    </Text>
  );
}

/** A tick box with the sentence beside it. Unticked until the person ticks it. */
function TickRow({ ticked, onToggle, children }: { ticked: boolean; onToggle: () => void; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: control.tap }}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel="Accept the GOD Group Privacy Notice"
        onPress={onToggle}
        hitSlop={8}
        style={{
          width: 24,
          height: 24,
          marginTop: 2,
          borderRadius: 7,
          borderWidth: 1.5,
          borderColor: ticked ? p.accent : p.ruleStrong,
          backgroundColor: ticked ? p.accent : p.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {ticked ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
      </Pressable>
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/** The adult box for a new sign-up. Unticked by default; the parent decides whether the step can go on. */
export function GodNoticeBox({
  notice,
  ticked,
  onToggle,
}: {
  notice: GodConsentState['notice'];
  ticked: boolean;
  onToggle: () => void;
}) {
  return (
    <TickRow ticked={ticked} onToggle={onToggle}>
      <NoticeText text={notice.adultText} linkText={ADULT_LINK_TEXT} href={notice.url} />
    </TickRow>
  );
}

/** The words and buttons of the next-sign-in step, with no state of their own. */
export function GodConsentPromptView({
  notice,
  ticked,
  busy,
  error,
  onToggle,
  onAccept,
  onNotNow,
}: {
  notice: GodConsentState['notice'];
  ticked: boolean;
  busy: boolean;
  error: string | null;
  onToggle: () => void;
  onAccept: () => void;
  onNotNow: () => void;
}) {
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Title level="h1">Our group privacy notice</Title>
        <Small>
          SnapApp is part of a group of apps. Please read the notice and tell us your choice. You can keep using SnapApp
          either way.
        </Small>
      </View>
      <Card>
        <GodNoticeBox notice={notice} ticked={ticked} onToggle={onToggle} />
      </Card>
      {error ? <Notice tone="risk">{error}</Notice> : null}
      <View style={{ gap: space.sm }}>
        <Button label="Accept" busy={busy} disabled={!ticked} onPress={onAccept} />
        <Button label="Not now" tone="outline" disabled={busy} onPress={onNotNow} />
      </View>
      <Small>If you choose Not now, your activity stays out of it. We only ask again if the notice changes.</Small>
    </View>
  );
}

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

/** The card's words, with no state of their own. */
export function GodWithdrawView({
  busy,
  error,
  done,
  onWithdraw,
}: {
  busy: boolean;
  error: string | null;
  done: boolean;
  onWithdraw: () => void;
}) {
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Body strong>Your data and GOD</Body>
        {done ? (
          <Small>
            Done. We have recorded your request and will stop combining your data with GOD. Your SnapApp account and its
            data are unchanged.
          </Small>
        ) : (
          <>
            <Small>
              You accepted the GOD Group Privacy Notice. You can withdraw at any time. Nothing else changes: your account
              and its data stay as they are.
            </Small>
            {error ? <Notice tone="risk">{error}</Notice> : null}
            <Button label="Stop combining my data with GOD" tone="outline" busy={busy} onPress={onWithdraw} />
          </>
        )}
      </View>
    </Card>
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

/** A parent's answer to the notice for one teen. The teen is never asked and cannot accept. Presentational. */
export function GuardianConsentBox({
  notice,
  teenName,
  accepted,
  busy,
  onAnswer,
}: {
  notice: GodConsentState['notice'];
  teenName: string;
  accepted: boolean;
  busy: boolean;
  onAnswer: (decision: 'accepted' | 'withdrawn') => void;
}) {
  const [ticked, setTicked] = useState(false);

  if (accepted) {
    return (
      <View style={{ gap: space.sm }}>
        <Small>
          You accepted the GOD Group Privacy Notice for teens for {teenName}. You can withdraw at any time. Nothing else
          changes.
        </Small>
        <Button
          label={`Stop combining ${teenName}’s data with GOD`}
          tone="outline"
          busy={busy}
          onPress={() => onAnswer('withdrawn')}
        />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm }}>
      <Body strong>Group privacy notice for {teenName}</Body>
      <TickRow ticked={ticked} onToggle={() => setTicked((v) => !v)}>
        <NoticeText text={notice.guardianText} linkText={GUARDIAN_LINK_TEXT} href={notice.teenUrl} />
      </TickRow>
      <Small>
        Without your tick, {teenName}’s activity stays out of it. {teenName} is never asked.
      </Small>
      <Button label={`Accept for ${teenName}`} busy={busy} disabled={!ticked} onPress={() => onAnswer('accepted')} />
    </View>
  );
}
