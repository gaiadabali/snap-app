import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase, type SavedCard } from '@/api';
import { Icon } from '@/components/Icon';
import { Button, Card, Divider, Screen, Small } from '@/components/ui';
import { EXPERIMENTAL_FEATURES_ENABLED } from '@/config';
import { formatAud, numeric, space, type, usePalette } from '@/theme';

/**
 * Taking the payment, and what happened.
 *
 * Three states on one screen rather than three routes, because they are one
 * moment from the user's side and a route change mid-charge invites a back
 * gesture into a half-finished purchase.
 *
 * The charge itself is two calls — `startCreditPurchase` records the intent,
 * `fulfilCreditPurchase` is the manual stand-in for a processor webhook. They
 * are separate on the server so that a real gateway can slot between them, and
 * this screen keeps the purchase id from the first so a failure after it can
 * still be reported against a real row rather than vanishing.
 */
type Phase = 'busy' | 'done' | 'failed';

export default function PayScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pack?: string; card?: string }>();

  const [phase, setPhase] = useState<Phase>('busy');
  const [purchase, setPurchase] = useState<CreditPurchase | null>(null);
  const [card, setCard] = useState<SavedCard | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // StrictMode double-invokes effects in development. A payment is the one
  // place where running twice is not merely wasteful, so the attempt is
  // guarded by a ref rather than trusting the effect to fire once.
  const charging = useRef(false);

  useEffect(() => {
    // The card is only a label, and the wallet behind it is a server stub.
    if (!EXPERIMENTAL_FEATURES_ENABLED) return undefined;
    let live = true;
    void api()
      .listSavedCards()
      .then((cards) => live && setCard(cards.find((c) => c.id === params.card) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [params.card]);

  useEffect(() => {
    if (!params.pack || charging.current) return undefined;
    charging.current = true;
    let live = true;

    void (async () => {
      setPhase('busy');
      setReason(null);
      try {
        const started = await api().startCreditPurchase(params.pack as string);
        if (!live) return;
        setPurchase(started);
        const paid = await api().fulfilCreditPurchase(started.id);
        if (!live) return;
        setPurchase(paid);
        const balance = await api().getCreditBalance();
        if (!live) return;
        setCredits(balance.creditsRemaining);
        setPhase('done');
      } catch (e) {
        if (!live) return;
        setReason(e instanceof Error ? e.message : 'The bank did not accept that card.');
        setPhase('failed');
      } finally {
        charging.current = false;
      }
    })();

    return () => {
      live = false;
    };
  }, [params.pack, attempt]);

  const body = {
    flex: 1,
    padding: space.gutter,
    paddingTop: insets.top + space.xl,
    paddingBottom: insets.bottom + space.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };

  if (phase === 'busy') {
    return (
      <Screen>
        <View style={body}>
          <StatusCircle bg={p.accentSoft}>
            <ActivityIndicator size="large" color={p.accentText} />
          </StatusCircle>
          <Text style={[type.h2, { color: p.ink, marginTop: space.xl }]}>Taking payment</Text>
          <Text
            style={[type.body, { color: p.inkMuted, marginTop: space.sm, textAlign: 'center', maxWidth: 300 }]}
          >
            {card ? `Authorising with ${card.label}.` : 'Authorising with your bank.'}
          </Text>
          <Small style={{ marginTop: space.lg }}>Do not close the app.</Small>
        </View>
      </Screen>
    );
  }

  const ok = phase === 'done';

  return (
    <Screen>
      <ScrollView contentContainerStyle={body}>
        <StatusCircle bg={ok ? p.goodSoft : p.riskSoft}>
          <Icon name={ok ? 'check' : 'close'} size={40} color={ok ? p.good : p.risk} />
        </StatusCircle>

        <Text style={[type.h1, { color: p.ink, marginTop: space.xl }]}>
          {ok ? 'Payment complete' : 'Payment declined'}
        </Text>
        <Text
          style={[type.body, { color: p.inkMuted, marginTop: space.sm, textAlign: 'center', maxWidth: 320 }]}
        >
          {ok
            ? `${purchase?.credits ?? 0} scans are on your account now.`
            : reason ?? 'The bank did not accept that card.'}
        </Text>

        <Card style={{ width: '100%', maxWidth: 380, marginTop: space.xl, gap: space.md }}>
          <SummaryRow label={ok ? 'Paid' : 'Attempted'} value={formatAud(purchase?.priceAud ?? null)} />
          {EXPERIMENTAL_FEATURES_ENABLED ? (
            <SummaryRow label="Method" value={card?.label ?? '—'} />
          ) : null}
          {ok ? (
            <>
              <SummaryRow label="Reference" value={(purchase?.id ?? '').slice(-10).toUpperCase()} />
              <Divider />
              <SummaryRow label="Credits now" value={String(credits ?? '—')} strong />
            </>
          ) : (
            <SummaryRow label="Nothing charged" value="Confirmed" good />
          )}
        </Card>

        <View style={{ width: '100%', maxWidth: 380, gap: space.sm, marginTop: space.lg }}>
          {ok ? (
            <>
              <Button label="Start scanning" onPress={() => router.replace('/capture')} />
              <Button label="Back to credits" tone="outline" onPress={() => router.replace('/credits')} />
            </>
          ) : (
            <>
              <Button label="Try again" onPress={() => setAttempt((n) => n + 1)} />
              <Button
                label="Choose another method"
                tone="outline"
                onPress={() => router.replace('/credits')}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** The large status mark: an icon in a soft tinted circle, centred and calm. */
function StatusCircle({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <View
      style={{
        width: 88,
        height: 88,
        borderRadius: 44,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  good,
}: {
  label: string;
  value: string;
  strong?: boolean;
  good?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md }}>
      <Text style={[type.body, { color: p.inkMuted }]}>{label}</Text>
      <Text
        style={[
          strong ? type.h3 : type.bodyStrong,
          numeric,
          { color: good ? p.good : strong ? p.accentText : p.ink },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
