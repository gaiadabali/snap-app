import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase } from '@/api';
import { StatusPill, providerLabel } from '@/app/orders';
import { GradientHero } from '@/components/rich';
import { Button, Card, Screen, ScreenHeader, Small } from '@/components/ui';
import { formatAud, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * One purchase, in enough detail to answer a bank statement query.
 *
 * Read from the list rather than a dedicated endpoint: there is no
 * `GET /v1/credits/purchases/:id`, and inventing a client-side fetch for one
 * would mean guessing a route the server does not serve.
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
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
      >
        <ScreenHeader title="Purchase" onBack={() => router.back()} />

        {order === undefined ? <Small>Loading…</Small> : null}
        {order === null ? <Small>That purchase is no longer on your account.</Small> : null}

        {order ? (
          <>
            <GradientHero style={{ borderRadius: radius.xl, padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
                <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                  <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>
                    {order.credits} scans
                  </Text>
                  <Text style={{ fontSize: 34, lineHeight: 40, fontWeight: '700', color: '#FFFFFF', ...numeric }}>
                    {formatAud(order.priceAud)}
                  </Text>
                </View>
                <StatusPill status={order.status} />
              </View>
            </GradientHero>

            <Card padded={false}>
              {rows.map(([label, value], i) => (
                <View
                  key={label}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                    paddingHorizontal: space.lg,
                    paddingVertical: space.md,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                  }}
                >
                  <Text style={[type.body, { color: p.inkMuted, fontSize: 14 }]}>{label}</Text>
                  <Text
                    style={[type.bodyStrong, numeric, { color: p.ink, fontSize: 14, textAlign: 'right' }]}
                  >
                    {value}
                  </Text>
                </View>
              ))}
            </Card>

            <Small>
              {order.status === 'paid'
                ? 'These credits are already on your balance and never expire.'
                : order.status === 'pending'
                  ? 'Nothing has been charged and no credits have been granted yet.'
                  : 'Nothing was charged for this order.'}
            </Small>

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

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
