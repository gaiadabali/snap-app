import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { api, type CreditPack, type CreditPurchase } from '@/api';
import { Loading } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, radius, space, usePalette } from '@/theme';

/**
 * Credits: scans bought with money, or granted free. Tenant-scoped, never
 * reset — `docs/ECOSYSTEM.md` D27.
 *
 * Deliberately not merged with Plan usage. A plan's scan quota resets every
 * month and answers "what does the subscription include"; a credit answers
 * "what did I buy, or get for free, on top of that" and never expires. Two
 * meters that behave differently must never share one number.
 *
 * There are three server resources here, not one — `GET /v1/credit-packs`,
 * `GET /v1/credits` and `GET /v1/credits/purchases` — because the server does
 * not compose them into a screen-shaped response either. This is the view
 * model this SCREEN wants, built from the three real ones; it is not a wire
 * type, and nothing here is exported for another screen to depend on.
 */
export default function CreditsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [purchases, setPurchases] = useState<CreditPurchase[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // In parallel: three independent resources, not one endpoint pretending
    // to be three.
    const [packRows, balance, purchaseRows] = await Promise.all([
      api().listCreditPacks(),
      api().getCreditBalance(),
      api().listCreditPurchases(),
    ]);
    setPacks(packRows);
    setRemaining(balance.creditsRemaining);
    setPurchases(purchaseRows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function buy(pack: CreditPack) {
    setError(null);
    setBuying(pack.code);
    try {
      // Two calls, not one: `start` records intent only (no payment
      // processor exists yet to redirect to), and `fulfil` is this demo
      // standing in for what a processor's webhook will call once one
      // exists. Collapsing them into a single "purchase" call would hide
      // that there is no checkout here — see docs/ECOSYSTEM.md D27.
      const started = await api().startCreditPurchase(pack.code);
      await api().fulfilCreditPurchase(started.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete that purchase.');
    } finally {
      setBuying(null);
    }
  }

  const loaded = packs !== null && remaining !== null && purchases !== null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.xs }}>
          <Label>Credits</Label>
          <Figure size="h1">Scans you own</Figure>
          <Small>
            Bought with money, or granted free. This never resets — it is separate from your
            plan's monthly quota (see Plan).
          </Small>
        </View>

        {!loaded ? (
          <Loading />
        ) : (
          <>
            <BalanceCard remaining={remaining} />

            {/* A new account starts with 10 free scans — a fixed fact of
                onboarding, not a row this screen can fetch: the server's
                balance is one aggregate number (`creditsRemaining`), with no
                per-grant breakdown endpoint to say which part of it was
                free. Said here as copy instead of invented as data. */}
            <Small>Every account starts with 10 free scans, included in the balance above.</Small>

            <View style={{ gap: space.sm }}>
              <Label>Buy more</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {packs.map((pack, i) => (
                  <PackTile
                    key={pack.code}
                    pack={pack}
                    index={i}
                    busy={buying === pack.code}
                    disabled={buying !== null}
                    onBuy={() => void buy(pack)}
                  />
                ))}
              </View>
              {error ? (
                <Small muted={false} style={{ color: p.risk }}>
                  {error}
                </Small>
              ) : null}
              <Small>
                No real checkout exists yet: buying here starts a purchase and fulfils it
                immediately, the same two steps a payment processor's webhook will do later.
              </Small>
            </View>

            <View style={{ gap: space.sm }}>
              <Label>Purchase history</Label>
              <Raised style={{ padding: 0 }}>
                {purchases.length === 0 ? (
                  <View style={{ padding: space.lg }}>
                    <Small>No purchases yet.</Small>
                  </View>
                ) : (
                  purchases.map((x, i) => (
                    <View key={x.id}>
                      {i > 0 ? <Divider /> : null}
                      <Animated.View
                        entering={FadeInDown.duration(240).delay(i * 40)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 13,
                        }}
                      >
                        <View style={{ flex: 1, gap: 1 }}>
                          <Body strong>{x.credits} scans</Body>
                          <Small>{formatShortDate(x.createdAt.slice(0, 10))}</Small>
                        </View>
                        <Figure size="body">{formatAud(x.priceAud)}</Figure>
                        {x.status !== 'paid' ? (
                          <Chip tone={x.status === 'failed' ? 'risk' : 'warn'}>{x.status}</Chip>
                        ) : null}
                      </Animated.View>
                    </View>
                  ))
                )}
              </Raised>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** The headline balance. Pulses on a real change — a purchase landing — never on its own. */
function BalanceCard({ remaining }: { remaining: number }) {
  const scale = useSharedValue(1);
  const prev = useRef(remaining);

  useEffect(() => {
    if (prev.current !== remaining) {
      scale.value = withSequence(withTiming(1.06, { duration: 140 }), withTiming(1, { duration: 180 }));
      prev.current = remaining;
    }
  }, [remaining, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View entering={FadeInDown.duration(260)}>
      <Raised style={{ gap: 4, alignItems: 'flex-start' }}>
        <Label>Remaining</Label>
        <Animated.View style={style}>
          <Figure size="display" tone="accent">
            {remaining}
          </Figure>
        </Animated.View>
        <Small>{remaining === 1 ? 'scan' : 'scans'} ready to use, any time</Small>
      </Raised>
    </Animated.View>
  );
}

function PackTile({
  pack,
  index,
  busy,
  disabled,
  onBuy,
}: {
  pack: CreditPack;
  index: number;
  busy: boolean;
  disabled: boolean;
  onBuy: () => void;
}) {
  const p = usePalette();
  return (
    <Animated.View
      entering={FadeInDown.duration(240).delay(index * 40)}
      style={{ flexGrow: 1, flexBasis: '30%', minWidth: 96 }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Buy ${pack.credits} scans for ${formatAud(pack.priceAud)}`}
        disabled={disabled}
        onPress={onBuy}
        style={({ pressed }) => ({
          borderRadius: radius.lg,
          borderWidth: 1.5,
          borderColor: p.rule,
          backgroundColor: pressed ? p.surfaceAlt : p.surface,
          padding: space.md,
          gap: 4,
          alignItems: 'center',
          opacity: disabled && !busy ? 0.5 : 1,
        })}
      >
        <Figure size="h2">{pack.credits}</Figure>
        <Small>scans</Small>
        <Body strong>{busy ? '…' : formatAud(pack.priceAud)}</Body>
      </Pressable>
    </Animated.View>
  );
}
