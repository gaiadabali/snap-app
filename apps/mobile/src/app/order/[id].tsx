import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase } from '@/api';
import { StatusPill, providerLabel } from '@/app/orders';
import { GradientHero, HeroFigure, HeroLabel } from '@/components/rich';
import { Button, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { formatAud, numeric, space, type, usePalette } from '@/theme';

/**
 * One purchase, in enough detail to answer a bank statement query.
 *
 * Read from the list rather than a dedicated endpoint: there is no
 * `GET /v1/credits/purchases/:id`, and inventing a client-side fetch for one
 * would mean guessing a route the server does not serve.
 *
 * Laid out as a receipt: the amount on the void panel, then label and value
 * pairs divided by hairlines, the status first because it is the question the
 * screen is opened to answer.
 */
export default function OrderScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<CreditPurchase | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .listCreditPurchases()
        .then((list) => live && setOrder(list.find((o) => o.id === id) ?? null))
        .catch(() => live && setOrder(null));
      return () => {
        live = false;
      };
    }, [id]),
  );

  const rows: Array<[string, string]> = order
    ? [
        ['Scans', String(order.credits)],
        ['Pack', order.packCode],
        ['Method', providerLabel(order.provider)],
        ['Ordered', when(order.createdAt)],
        ...(order.paidAt ? ([['Paid', when(order.paidAt)]] as Array<[string, string]>) : []),
        ['Reference', order.id.slice(-10).toUpperCase()],
      ]
    : [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Purchase" onBack={() => router.back()} />

        {order === undefined ? <Small>Loading…</Small> : null}
        {order === null ? <Small>That purchase is no longer on your account.</Small> : null}

        {order ? (
          <>
            <GradientHero>
              <HeroLabel>{`${order.credits} scans`}</HeroLabel>
              <View style={{ marginTop: 14, minHeight: 56 }}>
                <HeroFigure settle>{formatAud(order.priceAud)}</HeroFigure>
              </View>
            </GradientHero>

            <View style={{ gap: space.md }}>
              <Section label="Receipt">
                <ReceiptRow label="Status" first>
                  <StatusPill status={order.status} />
                </ReceiptRow>
                {rows.map(([label, value]) => (
                  <ReceiptRow key={label} label={label}>
                    <Text style={[type.amount, numeric, { color: p.ink, textAlign: 'right' }]}>{value}</Text>
                  </ReceiptRow>
                ))}
              </Section>

              <Small>
                {order.status === 'paid'
                  ? 'These credits are already on your balance and never expire.'
                  : order.status === 'pending'
                    ? 'Nothing has been charged and no credits have been granted yet.'
                    : 'Nothing was charged for this order.'}
              </Small>
            </View>

            <Button
              label="Top up again"
              icon="plus"
              tone="outline"
              onPress={() => router.replace('/credits')}
            />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** One label and its value, on a hairline. The value is whatever is passed —
 *  mono text, or the status badge. */
function ReceiptRow({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
      }}
    >
      <Text style={[type.label, { color: p.inkMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
