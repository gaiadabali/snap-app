import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPack, type SavedCard } from '@/api';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { Button, Notice, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { formatAud, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Credits: scans bought with money, or granted free. Tenant-scoped, never
 * reset — `docs/ECOSYSTEM.md` D27.
 *
 * Deliberately not merged with Plan usage. A plan's scan quota resets every
 * month and answers "what does the subscription include"; a credit answers
 * "what did I buy, or get for free, on top of that" and never expires. Two
 * meters that behave differently must never share one number.
 *
 * Rebuilt 2026-09-19 as the prototype's "Credits" screen: balance, a grid of
 * packs, the saved cards to charge, and a checkout bar pinned to the bottom
 * that only becomes live once BOTH a pack and a method are chosen. The bar is
 * pinned rather than inline because the packs grid can push it under the fold
 * on a small phone, and a checkout you have to scroll to find is a checkout
 * people abandon.
 *
 * Restyled 2026-10-19 (the instrument pass): the balance is the void panel's
 * figure, the packs are outline keys (the chosen one takes an ink edge, not a
 * tint), and the saved cards are selectable ledger lines with a ring for the
 * radio rather than a boxed list.
 */
export default function CreditsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [packs, setPacks] = useState<CreditPack[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [pack, setPack] = useState<CreditPack | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api().listCreditPacks().then((x) => live && setPacks(x)).catch(() => live && setPacks([]));
      void api().getCreditBalance().then((b) => live && setRemaining(b.creditsRemaining)).catch(() => {});
      void api()
        .listSavedCards()
        .then((x) => {
          if (!live) return;
          setCards(x);
          // Preselect the default, which is what almost everyone wants.
          setCardId((cur) => cur ?? x.find((c) => c.isDefault)?.id ?? null);
        })
        .catch(() => live && setCards([]));
      return () => {
        live = false;
      };
    }, []),
  );

  const hasCards = (cards?.length ?? 0) > 0;
  const ready = !!pack && !!cardId;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Credits" onBack={() => router.back()} />

        <GradientHero>
          <HeroLabel>CREDITS YOU OWN</HeroLabel>
          <View style={{ marginTop: 14, minHeight: 56 }}>
            <HeroFigure settle>{remaining !== null ? String(remaining) : '—'}</HeroFigure>
          </View>
          <View style={{ marginTop: 2 }}>
            <HeroBody>Credits never expire and never reset.</HeroBody>
          </View>
        </GradientHero>

        {/* Packs: three outline keys to a row. The chosen one keeps the same
            1.5px edge as the rest and only changes its colour, so selecting
            never moves the grid. */}
        <Section
          label="Top up"
          action={{ label: 'See past purchases', onPress: () => router.push('/orders') }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: space.md }}>
            {(packs ?? []).map((pk) => {
              const on = pack?.code === pk.code;
              return (
                <PressableScale
                  key={pk.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${pk.credits} scans for ${formatAud(pk.priceAud)}`}
                  onPress={() => setPack(on ? null : pk)}
                  containerStyle={{ flexBasis: '30%', flexGrow: 1 }}
                  style={{
                    borderWidth: 1.5,
                    borderColor: on ? p.ink : p.rule,
                    borderRadius: radius.md,
                    paddingVertical: 16,
                    paddingHorizontal: space.sm,
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Text style={[type.display, numeric, { fontSize: 28, lineHeight: 32, color: p.ink }]}>
                    {pk.credits}
                  </Text>
                  <Text style={[type.label, { color: p.inkMuted }]}>Scans</Text>
                  <Text style={[type.amount, numeric, { color: p.ink, marginTop: 4 }]}>
                    {formatAud(pk.priceAud)}
                  </Text>
                </PressableScale>
              );
            })}
            {packs?.length === 0 ? <Small>No packs are on sale right now.</Small> : null}
          </View>
        </Section>

        {/* Pay with */}
        <Section
          label="Pay with"
          action={hasCards ? { label: 'Add another', onPress: () => router.push('/wallet/add') } : undefined}
        >
          {cards === null ? (
            <View style={{ paddingTop: space.md }}>
              <Small>Loading your payment methods…</Small>
            </View>
          ) : hasCards ? (
            cards.map((c, i) => {
              const on = cardId === c.id;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setCardId(c.id)}
                  style={({ pressed }) => ({
                    minHeight: 64,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingVertical: space.md,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                    backgroundColor: pressed ? p.surface : 'transparent',
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: p.rule,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={c.provider === 'card' ? 'card' : 'wallet'} size={19} color={p.inkStrong} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                    {c.provider === 'card' ? (
                      <Text style={[type.mono, numeric, { color: p.inkMuted }]}>
                        Expires {String(c.expiryMonth).padStart(2, '0')}/{String(c.expiryYear).slice(-2)}
                      </Text>
                    ) : (
                      <Small>Confirmed on this device</Small>
                    )}
                  </View>
                  <Radio on={on} />
                </Pressable>
              );
            })
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/wallet/add')}
              style={({ pressed }) => ({
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                backgroundColor: pressed ? p.surface : 'transparent',
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: p.rule,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="plus" size={19} color={p.accentText} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.bodyStrong, { color: p.ink }]}>No payment method yet</Text>
                <Small>Add a card or wallet before your first top up.</Small>
              </View>
            </Pressable>
          )}
        </Section>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
      </ScrollView>

      {/* Checkout bar */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.rule,
          backgroundColor: p.ground,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[type.label, numeric, { color: pack ? p.ink : p.inkMuted }]} numberOfLines={1}>
            {pack ? `${pack.credits} scans · ${formatAud(pack.priceAud)}` : 'Choose a pack'}
          </Text>
        </View>
        <Button
          label="Pay"
          disabled={!ready}
          style={{ paddingHorizontal: 22 }}
          onPress={() => {
            if (!pack || !cardId) return;
            setError(null);
            router.push({ pathname: '/pay', params: { pack: pack.code, card: cardId } });
          }}
        />
      </View>
    </Screen>
  );
}

/** A ring with an accent dot when chosen. Drawn, not an icon, so it can
 *  never be mistaken for a checkbox. */
function Radio({ on }: { on: boolean }) {
  const p = usePalette();
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: on ? p.accent : p.ruleStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.accent }} /> : null}
    </View>
  );
}
