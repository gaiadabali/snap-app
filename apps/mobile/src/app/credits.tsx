import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditPack, type SavedCard } from '@/api';
import { Icon } from '@/components/Icon';
import { GradientHero } from '@/components/rich';
import {
  Body,
  Button,
  Card,
  Notice,
  Screen,
  ScreenHeader,
  SectionHeader,
  Small,
} from '@/components/ui';
import { formatAud, numeric, radius, shadow, space, type, usePalette, useTheme } from '@/theme';

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
 * Premium pass 2026-10-19: packs are white lifted tiles (the chosen one gets a
 * 2px accent border, not just a tint), "See past purchases" moved up into the
 * Top up header, and the pay bar is a white surface.
 */
export default function CreditsScreen() {
  const p = usePalette();
  const { scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Three tiles to a row between the 20pt gutters, with two 12pt gaps.
  const tileW = Math.floor((width - space.gutter * 2 - space.md * 2) / 3);

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
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Credits" onBack={() => router.back()} />

        <GradientHero>
          <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Credits you own</Text>
          <Text
            style={{
              fontSize: 44,
              lineHeight: 50,
              fontWeight: '700',
              color: '#FFFFFF',
              marginTop: space.xs,
              ...numeric,
            }}
          >
            {remaining ?? '—'}
          </Text>
          <Text style={[type.body, { color: 'rgba(255,255,255,0.95)', marginTop: space.xs }]}>
            Credits never expire and never reset.
          </Text>
        </GradientHero>

        {/* Packs */}
        <View style={{ gap: space.md }}>
          <SectionHeader
            title="Top up"
            action={{ label: 'See past purchases', onPress: () => router.push('/orders') }}
          />
          {/* Tiles keep ONE width (computed from the screen, three per row) and
              the rows are centred, so a short second row sits in the middle
              instead of stretching its tiles wider than the first row's. */}
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md }}
          >
            {(packs ?? []).map((pk) => {
              const on = pack?.code === pk.code;
              return (
                <Pressable
                  key={pk.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${pk.credits} scans for ${formatAud(pk.priceAud)}`}
                  onPress={() => setPack(on ? null : pk)}
                  style={[
                    {
                      width: tileW,
                      // Always 2px (transparent when off) so choosing a pack
                      // never nudges the grid.
                      borderWidth: 2,
                      borderColor: on ? p.accent : scheme === 'light' ? 'transparent' : p.cardEdge,
                      backgroundColor: p.card,
                      borderRadius: radius.xl,
                      paddingVertical: space.lg,
                      paddingHorizontal: space.sm,
                      alignItems: 'center',
                      gap: space.xs,
                    },
                    scheme === 'light' ? shadow.card : null,
                  ]}
                >
                  <Text style={{ ...type.h2, ...numeric, color: on ? p.accentText : p.ink }}>
                    {pk.credits}
                  </Text>
                  <Small>scans</Small>
                  <Text style={[type.bodyStrong, numeric, { color: p.accentText, marginTop: space.xs }]}>
                    {formatAud(pk.priceAud)}
                  </Text>
                </Pressable>
              );
            })}
            {packs?.length === 0 ? <Small>No packs are on sale right now.</Small> : null}
          </View>
        </View>

        {/* Pay with */}
        <View style={{ gap: space.md }}>
          <SectionHeader
            title="Pay with"
            action={hasCards ? { label: 'Add another', onPress: () => router.push('/wallet/add') } : undefined}
          />

          {cards === null ? (
            <Small>Loading your payment methods…</Small>
          ) : hasCards ? (
            <Card padded={false}>
              {cards.map((c, i) => {
                const on = cardId === c.id;
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setCardId(c.id)}
                    style={{
                      minHeight: 64,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                    }}
                  >
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: radius.md,
                        backgroundColor: p.accentSoft,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon
                        name={c.provider === 'card' ? 'card' : 'wallet'}
                        size={20}
                        color={p.accentText}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Body strong numberOfLines={1}>
                        {c.label}
                      </Body>
                      <Small>
                        {c.provider === 'card'
                          ? `Expires ${String(c.expiryMonth).padStart(2, '0')}/${String(c.expiryYear).slice(-2)}`
                          : 'Confirmed on this device'}
                      </Small>
                    </View>
                    <Radio on={on} />
                  </Pressable>
                );
              })}
            </Card>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => router.push('/wallet/add')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.md,
                    backgroundColor: p.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="plus" size={20} color={p.accentText} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Body strong>No payment method yet</Body>
                  <Small>Add a card or wallet before your first top up.</Small>
                </View>
              </Card>
            </Pressable>
          )}
        </View>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
      </ScrollView>

      {/* Checkout bar */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.rule,
          backgroundColor: p.card,
          paddingHorizontal: space.gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Small>{pack ? `${pack.credits} scans` : 'Choose a pack'}</Small>
          <Text style={[type.h2, numeric, { color: p.ink }]}>
            {pack ? formatAud(pack.priceAud) : '—'}
          </Text>
        </View>
        <Button
          label="Pay"
          disabled={!ready}
          style={{ paddingHorizontal: space.xl }}
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

function Radio({ on }: { on: boolean }) {
  const p = usePalette();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: on ? p.accent : p.ruleStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? (
        <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: p.accent }} />
      ) : null}
    </View>
  );
}
