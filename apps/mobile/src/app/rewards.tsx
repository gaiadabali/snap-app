import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Reward } from '@/api';
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
import { numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Trading points for scan credits.
 *
 * ⚠ This screen implements a redemption path that `PointLedgerEntry` in
 * `@snap/api-contract` says does not exist ("redemption happens in yourtal,
 * not in this product"). The 2026-09-19 prototype specifies it in as many
 * words, so it is built; the contradiction is written up on `Reward` in the
 * contract and needs a product decision, not a quiet fix in either direction.
 *
 * Both balances are shown because the trade moves both, and a screen that
 * shows only what you are spending makes the exchange rate invisible.
 */
export default function RewardsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    void api().listRewards().then(setRewards).catch(() => setRewards([]));
    void api().getPointBalance().then((b) => setPoints(b.balance)).catch(() => {});
    void api().getCreditBalance().then((b) => setCredits(b.creditsRemaining)).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function claim(reward: Reward) {
    setBusy(reward.id);
    setError(null);
    setDone(null);
    try {
      const res = await api().redeemReward(reward.id);
      // The response carries both balances, so nothing is refetched to show
      // the result — only the catalogue, whose affordability has changed.
      setPoints(res.pointsBalance);
      setCredits(res.creditsBalance);
      setDone(`${res.creditsGranted} credits added for ${res.pointsSpent} points.`);
      void api().listRewards().then(setRewards).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not claim that.');
    } finally {
      setBusy(null);
    }
  }

  const affordable = (rewards ?? []).filter((r) => r.available);

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
        <ScreenHeader title="Rewards" onBack={() => router.back()} />

        <GradientHero style={{ borderRadius: radius.xl, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Points</Text>
              <Text style={[type.h1, numeric, { fontSize: 28, lineHeight: 34, color: '#FFFFFF' }]}>
                {points?.toLocaleString('en-AU') ?? '—'}
              </Text>
            </View>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.22)' }} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Credits</Text>
              <Text style={[type.h1, numeric, { fontSize: 28, lineHeight: 34, color: '#FFFFFF' }]}>
                {credits?.toLocaleString('en-AU') ?? '—'}
              </Text>
            </View>
          </View>
        </GradientHero>

        <Small>
          Trade points for scan credits. Nothing here costs money, and points never expire.
        </Small>

        {done ? <Notice tone="good" icon="check">{done}</Notice> : null}
        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        {(rewards ?? []).map((r) => (
          <Card key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: space.lg }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md,
                backgroundColor: p.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="spark" size={22} color={p.accentText} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Body strong>{r.name}</Body>
              <Small numberOfLines={2}>{r.description}</Small>
              <Text style={[type.smallStrong, numeric, { color: p.accentText, marginTop: 2 }]}>
                {r.cost.toLocaleString('en-AU')} points
              </Text>
            </View>
            <Button
              label={r.available ? 'Claim' : 'Locked'}
              tone={r.available ? 'accent' : 'outline'}
              disabled={!r.available}
              busy={busy === r.id}
              onPress={() => void claim(r)}
              style={{ paddingHorizontal: space.lg }}
            />
          </Card>
        ))}

        {rewards !== null && affordable.length === 0 && rewards.length > 0 ? (
          <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
            <Icon name="spark" size={28} color={p.inkMuted} />
            <Body strong>Not enough points yet</Body>
            <Small style={{ textAlign: 'center' }}>
              Keep scanning to earn them. Every receipt counts.
            </Small>
          </Card>
        ) : null}

        <Notice tone="info" icon="info">
          Points come off your balance straight away and the credits land on your account in the
          same moment. There is nothing to redeem by email and no code to keep.
        </Notice>
      </ScrollView>
    </Screen>
  );
}
