import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Reward } from '@/api';
import { GradientHero, HeroFigure, HeroLabel } from '@/components/rich';
import { Button, Label, Notice, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { numeric, radius, space, type, usePalette } from '@/theme';

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
 *
 * Drawn 2026-10-19 (the instrument pass) as a panel with the two balances and
 * sections of lines under it. The rewards list stays a list of links: each
 * row's small "Open" outline says where a tap goes, because a "Redeem" button
 * here would promise a purchase this screen cannot make.
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
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title="Points and vouchers" onBack={() => router.back()} />

        {/* Two readouts on one panel: what you have earned, what you can scan with. */}
        <GradientHero>
          <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: space.lg }}>
            <View style={{ flex: 1, gap: 10 }}>
              <HeroLabel>POINTS</HeroLabel>
              <HeroFigure small settle>
                {points !== null ? points.toLocaleString('en-AU') : '—'}
              </HeroFigure>
            </View>
            <View style={{ width: 1, backgroundColor: p.voidRule }} />
            <View style={{ flex: 1, gap: 10 }}>
              <HeroLabel>CREDITS</HeroLabel>
              <HeroFigure small settle>
                {credits !== null ? credits.toLocaleString('en-AU') : '—'}
              </HeroFigure>
            </View>
          </View>
        </GradientHero>

        {/* How it actually works, in three steps, because the two-app loop is
            not guessable from either app on its own. */}
        <Section label="How this works">
          <View style={{ gap: space.md, paddingTop: space.md }}>
            <Step n={1} text="Every receipt you scan earns one point." />
            <Step n={2} text="Spend points in yourtal. You get a voucher with a code." />
            <Step n={3} text="Bring the code back here and the credits land on your account." />
          </View>
        </Section>

        {/* Redeem */}
        <Section label="Redeem a voucher">
          <View style={{ gap: space.md, paddingTop: space.md }}>
            <CodeField value={code} onChangeText={setCode} bad={!!error} />
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
          </View>
        </Section>

        {/* What points are for. Display only — spending happens in yourtal, so
            the row opens yourtal and the pill says so; it is not a buy button. */}
        <Section label="What your points can buy">
          {(rewards ?? []).map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="link"
              accessibilityLabel={`${r.name}, ${r.cost} points. Opens yourtal.`}
              onPress={() => void Linking.openURL(r.deepLink).catch(() => {})}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: p.rule,
                backgroundColor: pressed ? p.surface : 'transparent',
              })}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[type.bodyStrong, { color: p.ink }]}>{r.name}</Text>
                <Small numberOfLines={2}>{r.description}</Small>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 8 }}>
                <Text style={[type.amount, numeric, { color: p.ink }]}>
                  {r.cost.toLocaleString('en-AU')} pts
                </Text>
                <View
                  style={{
                    minHeight: 28,
                    paddingHorizontal: 12,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: p.ruleStrong,
                    borderRadius: radius.sm,
                  }}
                >
                  <Text style={[type.smallStrong, { color: p.ink }]}>Open</Text>
                </View>
              </View>
            </Pressable>
          ))}
          <View style={{ paddingTop: space.md }}>
            <Small>
              Tapping one opens yourtal, where the points are actually spent. Nothing on this list
              can be bought from inside Snap Apps.
            </Small>
          </View>
        </Section>
      </ScrollView>
    </Screen>
  );
}

/** A numbered line: the number is mono in a hairline square, not a tinted disc. */
function Step({ n, text }: { n: number; text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: radius.xs,
          borderWidth: 1,
          borderColor: p.ruleStrong,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[type.mono, numeric, { color: p.inkStrong }]}>{n}</Text>
      </View>
      <Text style={[type.small, { flex: 1, color: p.ink }]}>{text}</Text>
    </View>
  );
}

/**
 * The voucher box. Drawn like `Field` (mono label, hairline box, 2px accent
 * edge on focus) but with what `Field` does not pass through: the
 * accessibility label, `maxLength`, and a risk edge after a refused code. The
 * code is upper-cased and stripped of spaces as it is typed, so what is shown
 * is exactly what is sent.
 */
function CodeField({
  value,
  onChangeText,
  bad,
}: {
  value: string;
  onChangeText: (v: string) => void;
  bad: boolean;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>Voucher code</Label>
      <View
        style={{
          minHeight: 50,
          justifyContent: 'center',
          borderWidth: focused || bad ? 2 : 1,
          borderColor: bad ? p.risk : focused ? p.accent : p.ruleStrong,
          backgroundColor: p.ground,
          borderRadius: radius.md,
          paddingHorizontal: focused || bad ? 13 : 14,
        }}
      >
        <TextInput
          accessibilityLabel="Voucher code"
          value={value}
          onChangeText={(v) => onChangeText(v.toUpperCase().replace(/\s/g, ''))}
          placeholder="SNAP10"
          placeholderTextColor={p.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[type.amount, { fontSize: 16 }, numeric, { letterSpacing: 1.5, color: p.ink, paddingVertical: 12 }]}
        />
      </View>
    </View>
  );
}
