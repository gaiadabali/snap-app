import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { api, type PointLedgerEntry } from '@/api';
import { Loading } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { LedgerRow, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { formatShortDate, space } from '@/theme';

/** `reason` is a plain string on the wire (`PointLedgerEntry.reason`), not a
 *  closed union — new reasons can ship on the server without a client
 *  release, so an unrecognised one falls back to itself rather than "undefined". */
const KNOWN_REASONS: Record<string, string> = {
  scan: 'Receipt scanned',
  correction: 'Correction',
  adjustment: 'Adjustment',
};

function reasonLabel(reason: string): string {
  return KNOWN_REASONS[reason] ?? reason.charAt(0).toUpperCase() + reason.slice(1);
}

/**
 * Points: earned by scanning, yours wherever you sign in — user-scoped, not
 * tied to any one workspace, per `docs/ECOSYSTEM.md` D27.
 *
 * Two server resources, fetched in parallel: `GET /v1/points` (the balance
 * alone) and `GET /v1/points/ledger` (how it was earned). Neither call sends
 * a workspace header — points are keyed on the person, not a tenant.
 *
 * The explainer under "Redeeming points" is plain text, not a tinted card: it
 * is a caveat, and a caveat that looks like a feature invites a tap.
 *
 * The one thing this screen must not do is imply a point is spendable here.
 * It is not decided which app runs redemption, and D27 is explicit that an
 * outstanding point is a liability the moment it becomes redeemable — so the
 * honest state today is "earned, not yet spendable", not "coming soon".
 */
export default function PointsScreen() {
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<PointLedgerEntry[] | null>(null);

  const load = useCallback(async () => {
    const [bal, ledger] = await Promise.all([api().getPointBalance(), api().listPointLedger()]);
    setBalance(bal.balance);
    setEntries(ledger);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const loaded = balance !== null && entries !== null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.xs }}>
          <ScreenHeader title="Points" />
          <Small>Yours personally — they follow you, not any one workspace.</Small>
        </View>

        {!loaded ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <HeroLabel>BALANCE</HeroLabel>
              <View style={{ marginTop: 14, minHeight: 56 }}>
                <HeroFigure settle>{String(balance)}</HeroFigure>
              </View>
              <View style={{ marginTop: 2 }}>
                <HeroBody>{balance === 1 ? 'point' : 'points'}, one per scan</HeroBody>
              </View>
            </GradientHero>

            <Section label="Redeeming points">
              <View style={{ paddingTop: space.md }}>
                <Small>
                  Points cannot be spent in Snap Apps yet. Redemption arrives with yourtal, the
                  next app in the ecosystem — nothing here implies it ships today.
                </Small>
              </View>
            </Section>

            <Section label="How you earned them">
              {entries.length === 0 ? (
                <View style={{ paddingTop: space.md }}>
                  <Small>Scan a receipt to earn your first point.</Small>
                </View>
              ) : (
                entries.map((e, i) => (
                  <Animated.View key={e.id} entering={FadeIn.duration(240).delay(Math.min(i, 8) * 35)}>
                    <LedgerRow
                      first={i === 0}
                      gutter={formatShortDate(e.createdAt.slice(0, 10)).toUpperCase()}
                      title={reasonLabel(e.reason)}
                      figure={e.delta > 0 ? `+${e.delta}` : String(e.delta)}
                      figureTone={e.delta > 0 ? 'good' : e.delta < 0 ? 'muted' : 'ink'}
                    />
                  </Animated.View>
                ))
              )}
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
