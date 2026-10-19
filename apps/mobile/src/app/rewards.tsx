import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
import { control, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Points, and the vouchers they come back as.
 *
 * The loop, which this screen exists to make legible (yourtal docs/09 §7–8):
 *
 *     scan a receipt            earn 1 point
 *     spend points in yourtal   a voucher is minted, with a code
 *     bring the code here       Snap Apps honours it and grants credits
 *
 * So there is nothing to buy on this screen. An earlier build had a
 * points-for-credits store here, which contradicted the ledger's own rule
 * that points are only ever spent in yourtal; it was removed once the yourtal
 * side was read rather than guessed at.
 *
 * What IS here is the redeem box, because Snap Apps is the merchant at the end
 * of that loop — a redeemer in yourtal's authorize/capture protocol. The
 * client only submits a code: a client that could authorise could drain a
 * voucher, so the settlement calls belong on the server.
 */
export default function RewardsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [rewards, setRewards] = useState<Reward[] | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void api().listRewards().then(setRewards).catch(() => setRewards([]));
      void api().getPointBalance().then((b) => setPoints(b.balance)).catch(() => {});
      void api().getCreditBalance().then((b) => setCredits(b.creditsRemaining)).catch(() => {});
    }, []),
  );

  async function redeem() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await api().redeemVoucher({ code: code.trim() });
      setCredits(res.creditsBalance);
      setCode('');
      setDone(`${res.title} — ${res.creditsGranted} credits added.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not redeem that voucher.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="Points and vouchers" onBack={() => router.back()} />

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

        {/* How it actually works, in three steps, because the two-app loop is
            not guessable from either app on its own. */}
        <Card style={{ gap: space.md, padding: 18 }}>
          <Text style={[type.label, { color: p.inkMuted }]}>How this works</Text>
          <Step n={1} text="Every receipt you scan earns one point." />
          <Step n={2} text="Spend points in yourtal. You get a voucher with a code." />
          <Step n={3} text="Bring the code back here and the credits land on your account." />
        </Card>

        {/* Redeem */}
        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>Redeem a voucher</Text>
          <Card style={{ gap: 11, padding: 18 }}>
            <TextInput
              accessibilityLabel="Voucher code"
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase().replace(/\s/g, ''))}
              placeholder="SNAP10"
              placeholderTextColor={p.inkFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={24}
              style={{
                minHeight: control.input,
                borderWidth: 1.5,
                borderColor: error ? p.risk : p.rule,
                borderRadius: radius.md,
                backgroundColor: p.ground,
                paddingHorizontal: space.lg,
                ...type.input,
                ...numeric,
                letterSpacing: 1.5,
                color: p.ink,
              }}
            />
            <Button
              label="Redeem"
              busy={busy}
              disabled={code.trim().length < 6}
              onPress={() => void redeem()}
            />
            {done ? <Notice tone="good" icon="check">{done}</Notice> : null}
            {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
            <Small>
              A voucher is single-use. Credits land straight away and never expire.
            </Small>
          </Card>
        </View>

        {/* What points are for. Display only — spending happens in yourtal. */}
        <View style={{ gap: space.sm }}>
          <Text style={[type.label, { color: p.inkMuted }]}>What your points can buy</Text>
          {(rewards ?? []).map((r) => (
            <Pressable
              key={r.id}
              accessibilityRole="link"
              accessibilityLabel={`${r.name}, ${r.cost} points. Opens yourtal.`}
              onPress={() => void Linking.openURL(r.deepLink).catch(() => {})}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: space.lg }}>
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
                <Icon name="link" size={18} color={p.inkMuted} />
              </Card>
            </Pressable>
          ))}
          <Small>
            Tapping one opens yourtal, where the points are actually spent. Nothing on this list
            can be bought from inside Snap Apps.
          </Small>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: p.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[type.tab, numeric, { color: p.accentText }]}>{n}</Text>
      </View>
      <Text style={[type.small, { flex: 1, color: p.ink }]}>{text}</Text>
    </View>
  );
}
