import type { GodConsentState } from '@snap/api-contract';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Body, Button, Card, Notice, Small, Title } from '@/components/ui';
import { control, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

/**
 * The GOD Group Privacy Notice on the phone (god/TASKS.md 9.1.d). The two
 * sentences come from the server (`GET /v1/god-consent`), verbatim: this file
 * never types them, so the phone and the web cannot drift apart.
 *
 * This file is the PRESENTATIONAL half, with no data access (so it renders in the component tests):
 *   - `GodNoticeBox`        the unticked box a NEW sign-up must tick (Onboarding)
 *   - `GodConsentPromptView` the words of an EXISTING account's next sign-in step
 *   - `GodWithdrawView`     the words of "Stop combining my data with GOD"
 *   - `GuardianConsentBox`  a parent's tick for their teen (Family)
 * `GodConsent.tsx` holds the parts that fetch: the gate and the withdraw card.
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
