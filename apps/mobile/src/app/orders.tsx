import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPurchase, type CreditPurchaseStatus } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { Chip, LedgerRow, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { formatAud, space, type, usePalette } from '@/theme';

/**
 * Every top up, newest first.
 *
 * Was grouped under a heading per day, because the question people bring here
 * is "did that one on Tuesday go through". The ledger's date gutter answers
 * the same question down the left edge without a heading per day — a screen
 * of single-row groups was a label over every row — so the list is one
 * ledger, still newest first, each row dated.
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
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

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
        <ScreenHeader title="Purchases" onBack={() => router.back()} />

        <GradientHero>
          <HeroLabel>SPENT ON CREDITS</HeroLabel>
          <View style={{ marginTop: 14, minHeight: 56 }}>
            {orders !== null ? (
              <HeroFigure settle>{formatAud(sumMoney(paid.map((o) => o.priceAud)))}</HeroFigure>
            ) : null}
          </View>
          <View style={{ marginTop: 2 }}>
            <HeroBody>{paid.length === 1 ? '1 purchase' : `${paid.length} purchases`}</HeroBody>
          </View>
        </GradientHero>

        {orders !== null && list.length === 0 ? (
          <View style={{ gap: space.xs }}>
            <Text style={[type.bodyStrong, { color: p.ink }]}>No purchases yet</Text>
            <Small>Top ups appear here with their amount, method and status.</Small>
          </View>
        ) : null}

        {sorted.length > 0 ? (
          <Section label="Newest first">
            {sorted.map((o, i) => (
              <LedgerRow
                key={o.id}
                first={i === 0}
                gutter={shortDay(o.createdAt)}
                title={`${o.credits} scans`}
                note={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Small numberOfLines={1} style={{ flexShrink: 1 }}>
                      {providerLabel(o.provider)}
                    </Small>
                    <StatusPill status={o.status} />
                  </View>
                }
                figure={formatAud(o.priceAud)}
                figureTone={o.status === 'paid' || o.status === 'pending' ? 'ink' : 'muted'}
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
                accessibilityLabel={`${o.credits} scans, ${formatAud(o.priceAud)}, ${o.status}`}
              />
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/** The status as a mono badge. Red only for a failed payment — money that did
 *  not move — never for a refund, which is money coming back. */
export function StatusPill({ status }: { status: CreditPurchaseStatus }) {
  const tone = {
    paid: { tone: 'good', label: 'Paid' },
    pending: { tone: 'warn', label: 'Pending' },
    failed: { tone: 'risk', label: 'Failed' },
    refunded: { tone: 'neutral', label: 'Refunded' },
  }[status] as { tone: 'good' | 'warn' | 'risk' | 'neutral'; label: string };
  return <Chip tone={tone.tone}>{tone.label}</Chip>;
}

export function providerLabel(provider: string): string {
  // 'manual' is what the server sends until a real processor is wired; showing
  // the literal word to a customer would be meaningless.
  return provider === 'manual' ? 'Card on file' : provider;
}

/** "16 SEP" for the ledger gutter, in the device's own day. */
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }).toUpperCase();
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
