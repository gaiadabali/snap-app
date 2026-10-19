import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
  Small,
} from '@/components/ui';
import { control, formatAud, numeric, radius, space, type, usePalette } from '@/theme';

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
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xl,
          gap: 14,
        }}
      >
        <ScreenHeader title="Credits" onBack={() => router.back()} />

        <GradientHero style={{ borderRadius: 22 }}>
          <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Credits you own</Text>
          <Text
            style={{
              fontSize: 44,
              lineHeight: 50,
              fontWeight: '700',
              color: '#FFFFFF',
              marginTop: 5,
              ...numeric,
            }}
          >
            {remaining ?? '—'}
          </Text>
          <Text style={[type.body, { color: 'rgba(255,255,255,0.95)', marginTop: 4 }]}>
            Credits never expire and never reset.
          </Text>
        </GradientHero>

        {/* Packs */}
        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>Top up</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {(packs ?? []).map((pk) => {
              const on = pack?.code === pk.code;
              return (
                <Pressable
                  key={pk.code}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${pk.credits} scans for ${formatAud(pk.priceAud)}`}
                  onPress={() => setPack(on ? null : pk)}
                  style={{
                    // Three per row, accounting for the two 9pt gaps.
                    width: '31.5%',
                    flexGrow: 1,
                    borderWidth: 1.5,
                    borderColor: on ? p.accent : p.rule,
                    backgroundColor: on ? p.accentSoft : p.surface,
                    borderRadius: radius.md,
                    paddingVertical: 14,
                    paddingHorizontal: space.sm,
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Text style={{ ...type.h3, fontSize: 18, fontWeight: '700', ...numeric, color: p.ink }}>
                    {pk.credits}
                  </Text>
                  <Small>scans</Small>
                  <Text style={[type.bodyStrong, numeric, { color: p.ink }]}>{formatAud(pk.priceAud)}</Text>
                </Pressable>
              );
            })}
            {packs?.length === 0 ? <Small>No packs are on sale right now.</Small> : null}
          </View>
        </View>

        {/* Pay with */}
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[type.label, { color: p.inkMuted }]}>Pay with</Text>
            {hasCards ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/wallet/add')}
                style={{ minHeight: control.tap, justifyContent: 'center', paddingHorizontal: 10, marginRight: -10 }}
              >
                <Text style={[type.smallStrong, { color: p.accentText }]}>Add another</Text>
              </Pressable>
            ) : null}
          </View>

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
                      minHeight: 62,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 13,
                      paddingHorizontal: space.lg,
                      paddingVertical: 11,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        backgroundColor: p.surfaceAlt,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon name={c.provider === 'card' ? 'card' : 'wallet'} size={20} color={p.inkStrong} />
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
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/wallet/add')}
              style={{
                backgroundColor: p.surface,
                borderRadius: radius.md,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 13,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  backgroundColor: p.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="plus" size={20} color={p.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Body strong>No payment method yet</Body>
                <Small>Add a card or wallet before your first top up.</Small>
              </View>
            </Pressable>
          )}
        </View>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/orders')}
          style={{ minHeight: control.tap, justifyContent: 'center' }}
        >
          <Text style={[type.bodyStrong, { color: p.accentText }]}>See past purchases</Text>
        </Pressable>
      </ScrollView>

      {/* Checkout bar */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.rule,
          backgroundColor: p.ground,
          paddingHorizontal: 20,
          paddingTop: space.md,
          paddingBottom: insets.bottom + 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
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
