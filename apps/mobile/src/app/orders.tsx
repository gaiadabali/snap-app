import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase, type CreditPurchaseStatus } from '@/api';
import { Icon } from '@/components/Icon';
import { GradientHero } from '@/components/rich';
import { Body, Card, Screen, ScreenHeader, Small } from '@/components/ui';
import { formatAud, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Every top up, newest first, grouped by the day it happened.
 *
 * Grouped by day rather than listed flat because the question people bring
 * here is "did that one on Tuesday go through", and a date heading answers it
 * without reading a single row.
 */
export default function OrdersScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<CreditPurchase[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .listCreditPurchases()
        .then((x) => live && setOrders(x))
        .catch(() => live && setOrders([]));
      return () => {
        live = false;
      };
    }, []),
  );

  const list = orders ?? [];
  const paid = list.filter((o) => o.status === 'paid');
  const groups = groupByDay(list);

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
        <ScreenHeader title="Purchases" onBack={() => router.back()} />

        <GradientHero
          style={{
            borderRadius: radius.xl,
            padding: 18,
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: space.md,
          }}
        >
          <View style={{ gap: 3 }}>
            <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Spent on credits</Text>
            <Text style={[type.h1, numeric, { fontSize: 24, lineHeight: 30, color: '#FFFFFF' }]}>
              {formatAud(sumMoney(paid.map((o) => o.priceAud)))}
            </Text>
          </View>
          <Text style={[type.small, { color: 'rgba(255,255,255,0.95)', textAlign: 'right' }]}>
            {paid.length === 1 ? '1 purchase' : `${paid.length} purchases`}
          </Text>
        </GradientHero>

        {orders !== null && list.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: 34, paddingHorizontal: space.xl }}>
            <Body strong>No purchases yet</Body>
            <Small style={{ textAlign: 'center' }}>
              Top ups appear here with their amount, method and status.
            </Small>
          </Card>
        ) : null}

        {groups.map(([day, items]) => (
          <View key={day} style={{ gap: space.sm }}>
            <Text style={[type.label, { color: p.inkMuted }]}>{day}</Text>
            <Card padded={false}>
              {items.map((o, i) => (
                <Pressable
                  key={o.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.credits} scans, ${formatAud(o.priceAud)}, ${o.status}`}
                  onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
                  style={({ pressed }) => ({
                    minHeight: 72,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    paddingHorizontal: space.lg,
                    paddingVertical: 13,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                    backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                  })}
                >
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Body strong>{o.credits} scans</Body>
                    <Small numberOfLines={1}>{providerLabel(o.provider)}</Small>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    <Text style={[type.bodyStrong, numeric, { color: p.ink }]}>
                      {formatAud(o.priceAud)}
                    </Text>
                    <StatusPill status={o.status} />
                  </View>
                  <Icon name="chevronRight" size={17} color={p.inkMuted} />
                </Pressable>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

export function StatusPill({ status }: { status: CreditPurchaseStatus }) {
  const p = usePalette();
  const tone = {
    paid: { bg: p.goodSoft, fg: p.good, label: 'Paid' },
    pending: { bg: p.warnSoft, fg: p.warn, label: 'Pending' },
    failed: { bg: p.riskSoft, fg: p.risk, label: 'Failed' },
    refunded: { bg: p.surfaceAlt, fg: p.inkMuted, label: 'Refunded' },
  }[status];
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={[type.tab, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

export function providerLabel(provider: string): string {
  // 'manual' is what the server sends until a real processor is wired; showing
  // the literal word to a customer would be meaningless.
  return provider === 'manual' ? 'Card on file' : provider;
}

function groupByDay(list: CreditPurchase[]): Array<[string, CreditPurchase[]]> {
  const byDay = new Map<string, CreditPurchase[]>();
  for (const o of [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const day = new Date(o.createdAt).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    byDay.set(day, [...(byDay.get(day) ?? []), o]);
  }
  return [...byDay.entries()];
}

/**
 * Adds `MoneyString`s without going through a float.
 *
 * `0.1 + 0.2` is the reason: prices are decimal strings precisely so that a
 * total never drifts a cent from the sum of its rows.
 */
function sumMoney(values: string[]): string {
  let units = 0n;
  for (const v of values) {
    const [whole = '0', frac = ''] = v.replace('-', '').split('.');
    units += BigInt(whole) * 10_000n + BigInt((frac + '0000').slice(0, 4));
  }
  return `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
}
