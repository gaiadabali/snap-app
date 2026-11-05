import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useWorkspace } from '@/workspace';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase } from '@/api';
import { Icon } from '@/components/Icon';
import { Button, Card, Divider, Screen, Small } from '@/components/ui';
import { formatAud, numeric, space, type, usePalette } from '@/theme';

/**
 * Taking the payment, and what happened.
 *
 * Three states on one screen rather than three routes, because they are one
 * moment from the user's side and a route change mid-charge invites a back
 * gesture into a half-finished purchase.
 *
 * `startCreditPurchase` records the intent, `checkoutCreditPurchase` returns
 * the processor's hosted page, and the card is typed THERE, in the system
 * browser, never in this app (group task 7.5.d). Credits come from the
 * processor's signed webhook, so when the browser closes this screen only
 * reads the purchase back; it never marks anything paid. The purchase id is
 * kept so a failure is reported against a real row rather than vanishing.
 */
type Phase = 'busy' | 'done' | 'failed';

export default function PayScreen() {
  // A teen's own space buys nothing: its scans spend the parent's credits (group 3.10, F112).
  const teenSpace = useWorkspace().active.teenSpace === 'teen';
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ pack?: string }>();

  const [phase, setPhase] = useState<Phase>('busy');
  const [purchase, setPurchase] = useState<CreditPurchase | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // StrictMode double-invokes effects in development. A payment is the one
  // place where running twice is not merely wasteful, so the attempt is
  // guarded by a ref rather than trusting the effect to fire once.
  const charging = useRef(false);

  useEffect(() => {
    // A teen's space buys nothing (F112): no purchase request, even before the redirect below renders.
    if (teenSpace || !params.pack || charging.current) return undefined;
    charging.current = true;
    let live = true;

    void (async () => {
      setPhase('busy');
      setReason(null);
      try {
        const started = await api().startCreditPurchase(params.pack as string);
        if (!live) return;
        setPurchase(started);
        const session = await api().checkoutCreditPurchase(started.id);
        if (session.state !== 'redirect' || !session.url) {
          throw new Error(session.message ?? 'Card payments are not available right now. Nothing was charged.');
        }
        // No return address: resolves when the person closes the browser.
        await WebBrowser.openAuthSessionAsync(session.url, null);
        const after = await settledPurchase(started.id);
        if (!live) return;
        if (after) setPurchase(after);
        if (after?.status !== 'paid') {
          setReason(
            'We have not received a payment for this order. If you did pay, your scans appear in a minute or two.',
          );
          setPhase('failed');
          return;
        }
        const balance = await api().getCreditBalance();
        if (!live) return;
        setCredits(balance.creditsRemaining);
        setPhase('done');
      } catch (e) {
        if (!live) return;
        setReason(e instanceof Error ? e.message : 'The payment did not go through. Nothing was charged.');
        setPhase('failed');
      } finally {
        charging.current = false;
      }
    })();

    return () => {
      live = false;
    };
  }, [params.pack, attempt, teenSpace]);

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
            Finish paying in the browser, then close it to come back here.
          </Text>
          <Small style={{ marginTop: space.lg }}>Do not close the app.</Small>
        </View>
      </Screen>
    );
  }

  const ok = phase === 'done';

  if (teenSpace) return <Redirect href="/" />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={body}>
        <StatusCircle bg={ok ? p.goodSoft : p.riskSoft}>
          <Icon name={ok ? 'check' : 'close'} size={40} color={ok ? p.good : p.risk} />
        </StatusCircle>

        <Text style={[type.h1, { color: p.ink, marginTop: space.xl }]}>
          {ok ? 'Payment complete' : 'Payment not taken'}
        </Text>
        <Text
          style={[type.body, { color: p.inkMuted, marginTop: space.sm, textAlign: 'center', maxWidth: 320 }]}
        >
          {ok
            ? `${purchase?.credits ?? 0} scans are on your account now.`
            : reason ?? 'The payment did not go through. Nothing was charged.'}
        </Text>

        <Card style={{ width: '100%', maxWidth: 380, marginTop: space.xl, gap: space.md }}>
          <SummaryRow label={ok ? 'Paid' : 'Attempted'} value={formatAud(purchase?.priceAud ?? null)} />
          {ok ? (
            <>
              <SummaryRow label="Reference" value={(purchase?.id ?? '').slice(-10).toUpperCase()} />
              <Divider />
              <SummaryRow label="Credits now" value={String(credits ?? '—')} strong />
            </>
          ) : (
            <SummaryRow label="Order" value={purchase ? purchase.status : 'Not placed'} />
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
                label="Back to credits"
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
 * The purchase once the webhook has had a moment: the simulated checkout
 * delivers it before sending the browser on, a real processor within seconds.
 */
async function settledPurchase(id: string): Promise<CreditPurchase | undefined> {
  for (let i = 0; i < 5; i += 1) {
    const found = (await api().listCreditPurchases()).find((x) => x.id === id);
    if (found?.status !== 'pending') return found;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return (await api().listCreditPurchases()).find((x) => x.id === id);
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
