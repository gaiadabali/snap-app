import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api, type PointLedgerEntry } from '@/api';
import { Loading } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, Card, Divider, Figure, Label, Screen, Small } from '@/components/ui';
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
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.xs }}>
          <Label>Points</Label>
          <Figure size="h1">Earned by scanning</Figure>
          <Small>Yours personally — they follow you, not any one workspace.</Small>
        </View>

        {!loaded ? (
          <Loading />
        ) : (
          <>
            <Animated.View entering={FadeInDown.duration(260)}>
              <Raised style={{ gap: 4, alignItems: 'flex-start' }}>
                <Label>Balance</Label>
                <Figure size="display" tone="accent">
                  {balance}
                </Figure>
                <Small>{balance === 1 ? 'point' : 'points'}, one per scan</Small>
              </Raised>
            </Animated.View>

            <Card tone="default">
              <View style={{ gap: space.xs }}>
                <Label>Redeeming points</Label>
                <Body>
                  Points cannot be spent in Snap Apps yet. Redemption arrives with yourtal, the
                  next app in the ecosystem — nothing here implies it ships today.
                </Body>
              </View>
            </Card>

            <View style={{ gap: space.sm }}>
              <Label>How you earned them</Label>
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
                          paddingVertical: 13,
                        }}
                      >
                        <View style={{ flex: 1, gap: 1 }}>
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
