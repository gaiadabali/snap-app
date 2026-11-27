import { useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { Icon, type IconName } from '@/components/Icon';
import { Body, Button, Card, Label, Notice, Small, Title } from '@/components/ui';
import { bridgeErrorMessage } from '@/lib/mail-format';
import { space, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { CopyButton } from './CopyButton';

export type SwitchOnPhase =
  | { step: 'idle' }
  | { step: 'working' }
  | { step: 'done'; address: string }
  | { step: 'error'; message: string };

const POINTS: { icon: IconName; text: string }[] = [
  {
    icon: 'inbox',
    text: 'You get a friendly generated address, such as geewizduck@yourtal.gaiada.com. It is chosen for you and stays yours.',
  },
  { icon: 'ban', text: 'Marketing and bulk mail is filed into Spam and Junk, so your Inbox is left for people and bills.' },
  {
    icon: 'doc',
    text: 'Statements sent to this address can be imported into SnapApp. That is off until you turn it on in Mail settings.',
  },
];

/** The words and buttons, with no state of their own (`SwitchOn.test.tsx`). Same copy as the website. */
export function SwitchOnView({
  phase,
  onSwitchOn,
  onContinue,
}: {
  phase: SwitchOnPhase;
  onSwitchOn: () => void;
  onContinue: () => void;
}) {
  const p = usePalette();
  if (phase.step === 'done') {
    return (
      <View style={{ gap: space.lg }}>
        <View style={{ gap: space.xs }}>
          <Label style={{ color: p.accentText }}>Spambank</Label>
          <Title>Your inbox is ready</Title>
          <Body muted>This is your new address. It works in SnapApp, YourTal and Free Tax Returns.</Body>
        </View>
        <Card tone="accent" style={{ gap: space.sm }}>
          <Label>Your address</Label>
          <Text selectable testID="new-address" style={{ color: p.ink, fontSize: 18, lineHeight: 25, fontWeight: '600' }}>
            {phase.address}
          </Text>
          <CopyButton text={phase.address} label="Copy your address" />
          <Small>Give this address to the shops and newsletters you would otherwise give your real one to.</Small>
        </Card>
        <Button label="Open your inbox" onPress={onContinue} />
      </View>
    );
  }
  const working = phase.step === 'working';
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.xs }}>
        <Label style={{ color: p.accentText }}>Spambank</Label>
        <Title>Get your own Spambank inbox</Title>
        <Body muted>
          A real email address that keeps marketing mail out of your way. One inbox, shared by SnapApp, YourTal and Free
          Tax Returns.
        </Body>
      </View>
      <View style={{ gap: space.md }}>
        {POINTS.map((point) => (
          <View key={point.icon} style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <View style={{ marginTop: 2 }}>
              <Icon name={point.icon} size={22} color={p.accentText} />
            </View>
            <Body style={{ flex: 1 }}>{point.text}</Body>
          </View>
        ))}
      </View>
      {phase.step === 'error' ? (
        <Notice tone="risk" icon="alert">
          {phase.message}
        </Notice>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button
          label={working ? 'Setting up your inbox…' : 'Switch on mail'}
          icon="mail"
          busy={working}
          onPress={onSwitchOn}
        />
        <Small>For adults. You can stop using it at any time.</Small>
      </View>
    </View>
  );
}

/** The sentence for a failed switch-on. Never the server's own wording. */
export function switchOnMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : null;
  // The one place "not allowed" can be explained: mail is for adults.
  if (code === 'not_allowed') return 'Mail is for adult accounts, so it cannot be switched on here.';
  return bridgeErrorMessage(e);
}

export function SwitchOn({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<SwitchOnPhase>({ step: 'idle' });

  async function switchOn() {
    setPhase({ step: 'working' });
    try {
      const { address } = await api().enableMail();
      setPhase({ step: 'done', address });
    } catch (e) {
      setPhase({ step: 'error', message: switchOnMessage(e) });
    }
  }

  return <SwitchOnView phase={phase} onSwitchOn={() => void switchOn()} onContinue={onDone} />;
}
