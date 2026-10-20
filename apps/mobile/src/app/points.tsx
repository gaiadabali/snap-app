import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api, type PointLedgerEntry } from '@/api';
import { Loading } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Card, Divider, Figure, Screen, ScreenHeader, SectionHeader, Small } from '@/components/ui';
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
 * The one thing this screen must not do is imply a point is spendable here.
 * It is not decided which app runs redemption, and D27 is explicit that an
 * outstanding point is a liability the moment it becomes redeemable — so the
 * honest state today is "earned, not yet spendable", not "coming soon".
 */
export default function PointsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.xs }}>
          <ScreenHeader title="Points" onBack={() => router.back()} />
          <Small>Earned by scanning. Yours personally — they follow you, not any one workspace.</Small>
        </View>

        {!loaded ? (
          <Loading />
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(260)}>
              <GradientHero>
                <View style={{ gap: space.xs }}>
                  <HeroLabel>Balance</HeroLabel>
                  <HeroFigure>{balance}</HeroFigure>
                  <HeroBody>{balance === 1 ? 'point' : 'points'}, one per scan</HeroBody>
                </View>
              </GradientHero>
            </Animated.View>

            <View style={{ gap: space.md }}>
              <SectionHeader title="Redeeming points" />
              <Card tone="default">
                <Body>
                  Points from receipts will land in your YourTal wallet once you link your YourTal
                  account. Linking is coming soon, so nothing is paid there yet. Points cannot be
                  spent inside Snap Apps.
                </Body>
              </Card>
            </View>

            <View style={{ gap: space.md }}>
              <SectionHeader title="How you earned them" />
              <Raised style={{ padding: 0 }}>
                {entries.length === 0 ? (
                  <View style={{ padding: space.lg }}>
                    <Small>Scan a receipt to earn your first point.</Small>
                  </View>
                ) : (
                  entries.map((e, i) => (
                    <View key={e.id}>
                      {i > 0 ? <Divider /> : null}
                      <Animated.View
                        entering={FadeInDown.duration(240).delay(i * 35)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: space.md,
                        }}
                      >
                        <View style={{ flex: 1, gap: space.xs }}>
                          <Body strong>{reasonLabel(e.reason)}</Body>
                          <Small>{formatShortDate(e.createdAt.slice(0, 10))}</Small>
                        </View>
                        <Figure size="body" tone={e.delta < 0 ? 'risk' : 'ink'}>
                          {e.delta > 0 ? `+${e.delta}` : e.delta}
                        </Figure>
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
