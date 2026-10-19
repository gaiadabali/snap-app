import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Recurring } from '@/api';
import { Empty, Loading } from '@/components/form';
import { CategoryIcon, GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, space } from '@/theme';

/**
 * Subscriptions and standing bills, found rather than entered.
 *
 * Nobody maintains a list of their own direct debits, which is exactly why
 * they leak money. These are detected from the receipts themselves: a merchant
 * that appears in three or more of the last six months at a stable amount.
 *
 * The figure that changes behaviour is the ANNUAL one. A $17 monthly charge
 * reads as nothing; $204 a year reads as a decision.
 */
export default function RecurringScreen() {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Recurring[] | null>(null);

  const load = useCallback(async () => {
    setRows(await api().listRecurring());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const all = rows ?? [];
  const monthly = all.reduce((a, r) => a + Number(r.typicalAmount), 0);
  const annual = all.reduce((a, r) => a + Number(r.annualCost), 0);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {rows === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Committed each year</HeroLabel>
                <HeroFigure>{formatAud(annual.toFixed(4), { cents: false })}</HeroFigure>
                <HeroBody>
                  {formatAud(monthly.toFixed(4))} a month across {all.length} recurring{' '}
                  {all.length === 1 ? 'cost' : 'costs'}
                </HeroBody>
              </View>
            </GradientHero>

            {all.length === 0 ? (
              <Empty
                title="Nothing recurring yet"
                detail="Once a merchant appears three months running at a steady amount, it shows up here automatically."
              />
            ) : (
              <View style={{ gap: space.sm }}>
                <Label>Found in your receipts</Label>
                <Raised style={{ padding: 0 }}>
                  {all.map((r, i) => (
                    <View key={r.merchant}>
                      {i > 0 ? <Divider style={{ marginLeft: 68 }} /> : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 13,
                        }}
                      >
                        <CategoryIcon category={r.category} size={38} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong numberOfLines={1}>
                            {r.merchant}
                          </Body>
                          <View
                            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                          >
                            <Small numberOfLines={1}>
                              {formatAud(r.typicalAmount)}/mo · next {formatShortDate(r.nextExpected)}
                            </Small>
                            <Chip>{r.monthsSeen} months</Chip>
                          </View>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Figure size="h2">
                            {formatAud(r.annualCost, { cents: false })}
                          </Figure>
                          <Small>a year</Small>
                        </View>
                      </View>
                    </View>
                  ))}
                </Raised>
              </View>
            )}

            <Small style={{ textAlign: 'center' }}>
              Detected from what you have scanned, so it only knows about costs that leave a
              receipt. A direct debit you never see paperwork for will not appear.
            </Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
