import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase, type SavedCard } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { Button, Screen, Small } from '@/components/ui';
import { formatAud, numeric, onVoid, space, type, usePalette } from '@/theme';

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
 *
 * The step readout in the panel (ORDER, CHARGE, CREDIT) is those two calls and
 * the balance read that follows them, and nothing else: which step is lit is
 * worked out from what the screen already holds — no purchase yet means the
 * order is being recorded, a purchase that is not `paid` means the charge is
 * in flight, a paid one means the balance is being read — so it cannot say a
 * step happened that did not.
 */
type Phase = 'busy' | 'done' | 'failed';

const STEPS = ['ORDER', 'CHARGE', 'CREDIT'] as const;

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

  // Which step the screen is on: 0 order, 1 charge, 2 credit.
  const stage = !purchase ? 0 : purchase.status !== 'paid' ? 1 : 2;
  const body = {
    paddingHorizontal: space.lg,
    paddingTop: insets.top + space.xl,
    paddingBottom: insets.bottom + space.xl,
    gap: space.xl,
  };

  if (phase === 'busy') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={body}>
          <GradientHero>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <HeroLabel>PAYMENT</HeroLabel>
              <ActivityIndicator size="small" color={onVoid.accent} />
            </View>
            <View style={{ marginTop: 14 }}>
              <Text style={[type.h2, { color: p.voidInk }]}>Taking payment</Text>
            </View>
            <View style={{ marginTop: space.xs }}>
              <HeroBody>
                {card ? `Authorising with ${card.label}.` : 'Authorising with your bank.'}
              </HeroBody>
            </View>
            <Steps stage={stage} state="busy" />
          </GradientHero>
          <Small style={{ textAlign: 'center' }}>Do not close the app.</Small>
        </ScrollView>
      </Screen>
    );
  }

  const ok = phase === 'done';

  return (
    <Screen>
      <ScrollView contentContainerStyle={body}>
        <GradientHero tone={ok ? 'brand' : 'risk'}>
          {ok ? (
            <Text style={[type.label, { color: onVoid.good }]}>PAYMENT COMPLETE</Text>
          ) : (
            <HeroLabel>PAYMENT DECLINED</HeroLabel>
          )}
          <View style={{ marginTop: 14, minHeight: 56 }}>
            <HeroFigure settle>
              {ok ? `+${purchase?.credits ?? 0}` : formatAud(purchase?.priceAud ?? null)}
            </HeroFigure>
          </View>
          <View style={{ marginTop: 2 }}>
            <HeroBody>
              {ok
                ? `${purchase?.credits ?? 0} scans are on your account now.`
                : reason ?? 'The bank did not accept that card.'}
            </HeroBody>
          </View>
          <Steps stage={stage} state={ok ? 'done' : 'failed'} />
        </GradientHero>

        <View>
          <SummaryRow label={ok ? 'Paid' : 'Attempted'} value={formatAud(purchase?.priceAud ?? null)} first />
          <SummaryRow label="Method" value={card?.label ?? '—'} />
          {ok ? (
            <>
              <SummaryRow label="Reference" value={(purchase?.id ?? '').slice(-10).toUpperCase()} />
              <SummaryRow label="Credits now" value={String(credits ?? '—')} strong />
            </>
          ) : (
            <SummaryRow label="Nothing charged" value="Confirmed" good />
          )}
        </View>

        <View style={{ gap: 10 }}>
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

/**
 * ORDER → CHARGE → CREDIT, in mono, on the panel's own hairline.
 *
 * Steps behind the current one read as done, the current one in the accent
 * while busy, the ones ahead dimmed. On a finished payment every step is done;
 * on a failed one the step that was in flight is the one marked, in red, and
 * the ones after it stay dim — so a decline tells you how far it got.
 */
function Steps({ stage, state }: { stage: number; state: 'busy' | 'done' | 'failed' }) {
  const p = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={`Step ${Math.min(stage + 1, STEPS.length)} of ${STEPS.length}: ${STEPS[stage]?.toLowerCase()}`}
      style={{
        marginTop: 22,
        marginHorizontal: -20,
        marginBottom: -20,
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: p.voidRule,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {STEPS.map((s, i) => {
        const done = state === 'done' || i < stage;
        const current = i === stage && state !== 'done';
        const color =
          current && state === 'failed'
            ? onVoid.risk
            : current
              ? onVoid.accent
              : done
                ? p.voidInk
                : p.voidMuted;
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {i > 0 ? <Text style={[type.label, { color: p.voidMuted }]}>→</Text> : null}
            <Text style={[type.label, { color, opacity: done || current ? 1 : 0.55 }]}>{s}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  good,
  first,
}: {
  label: string;
  value: string;
  strong?: boolean;
  good?: boolean;
  first?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
      }}
    >
      <Text style={[type.label, { color: p.inkMuted }]}>{label}</Text>
      <Text
        style={[
          strong ? type.figure : type.amount,
          numeric,
          { color: good ? p.good : strong ? p.accentText : p.ink },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}
