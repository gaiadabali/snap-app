import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type DocumentView, type PersonalSummary } from '@/api';
import { CategoryBars } from '@/components/charts';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { UpdateNotice } from '@/components/UpdateNotice';
import { formatAud, space, usePalette } from '@/theme';
import { WorkspaceSwitch } from '@/workspace';

import { Action, LatestReceipts, greeting } from './shared';

/**
 * Personal home: is this month going to hold?
 *
 * Everything tax is gone — no ABN, no GST, no tax invoice, no BAS — because
 * none of it applies to a household and all of it made the business screen
 * feel like accounting software. What replaces it is the one number a personal
 * tracker exists to produce: what is safe to spend today.
 *
 * The pace line under the hero is the honest version of that. Comparing a
 * part-month against a whole previous month is how most trackers flatter or
 * frighten their users; this one compares against the same day last month.
 */
export default function PersonalHome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      api().getPersonal(),
      api().listDocuments('all', 'personal'),
    ]);
    setSummary(s);
    setDocs(d);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const over = summary ? Number(summary.remaining) < 0 : false;
  const spent = Number(summary?.spentThisMonth ?? 0);
  const lastMonth = Number(summary?.lastMonthToDate ?? 0);
  const pace = lastMonth === 0 ? null : (spent - lastMonth) / lastMonth;
  const budgetUsed = summary ? spent / Math.max(Number(summary.budgetTotal), 1) : 0;
  // Where you should be by now if the month were spent evenly.
  const monthElapsed = summary
    ? summary.daysElapsed / (summary.daysElapsed + summary.daysLeftInMonth - 1)
    : 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl + insets.bottom,
          gap: space.lg,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.accent} />
        }
      >
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          {/* Renders nothing unless a newer build is actually published. */}
          <UpdateNotice />
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Small>{greeting()}</Small>
              {IS_DEMO ? <Chip tone="warn">Demo</Chip> : null}
            </View>
            <Figure size="h1">{summary?.monthLabel ?? 'Personal'}</Figure>
          </View>
          <WorkspaceSwitch />
        </View>

        {/* The hero is what is LEFT, not what is spent. A tracker that leads
            with the total spent tells you about the past; this one is about
            the rest of the month. */}
        <View style={{ paddingHorizontal: space.lg }}>
          <GradientHero tone={over ? 'risk' : 'brand'}>
            <View style={{ gap: space.xs }}>
              <HeroLabel>{over ? 'Over budget this month' : 'Left to spend this month'}</HeroLabel>
              <HeroFigure>
                {formatAud(over ? `-${summary?.remaining.replace('-', '')}` : summary?.remaining)}
              </HeroFigure>
              <HeroBody>
                {formatAud(summary?.spentThisMonth, { cents: false })} of{' '}
                {formatAud(summary?.budgetTotal, { cents: false })} ·{' '}
                {summary?.daysLeftInMonth ?? 0} day
                {summary?.daysLeftInMonth === 1 ? '' : 's'} to go
              </HeroBody>

              {/* Budget used against month elapsed. The pale marker is where
                  an even spend would put you today — the gap between the two
                  is the whole message. */}
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  marginTop: space.sm,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    left: `${Math.min(100, monthElapsed * 100)}%`,
                    width: 2,
                    top: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255,255,255,0.95)',
                  }}
                />
                <View
                  style={{
                    width: `${Math.min(100, Math.max(2, budgetUsed * 100))}%`,
                    height: '100%',
                    backgroundColor: '#FFFFFF',
                    opacity: 0.85,
                    borderRadius: 4,
                  }}
                />
              </View>
            </View>
          </GradientHero>
        </View>

        {/* Two figures, both actionable: what today allows, and whether this
            month is running hotter than the last one. */}
        <View style={{ flexDirection: 'row', paddingHorizontal: space.lg, gap: space.sm }}>
          <Raised style={{ flex: 1, gap: 5 }}>
            <Label>Safe to spend</Label>
            <Figure size="h1" tone={over ? 'risk' : 'accent'}>
              {formatAud(summary?.safeToSpendPerDay)}
            </Figure>
            <Small>per day, for {summary?.daysLeftInMonth ?? 0} days</Small>
          </Raised>
          <Raised style={{ flex: 1, gap: 5 }}>
            <Label>Vs last month</Label>
            <Figure size="h1" tone={pace !== null && pace > 0 ? 'risk' : 'ink'}>
              {pace === null ? '—' : `${pace > 0 ? '+' : ''}${Math.round(pace * 100)}%`}
            </Figure>
            <Small>{formatAud(summary?.lastMonthToDate, { cents: false })} by this day</Small>
          </Raised>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: space.lg, gap: space.sm }}>
          <Action glyph="🧾" label="Spending" href="/receipts" />
          <Action glyph="📈" label="Analytics" href="/analytics" />
          <Action glyph="🎯" label="Budgets" href="/budgets" />
          <Action glyph="🔁" label="Recurring" href="/recurring" />
        </View>

        {/* Categories measured against their budgets, not against each other:
            in a household the question is "am I over?", not "what is biggest?" */}
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Label>This month by category</Label>
          <Raised>
            {summary ? (
              <CategoryBars parts={summary.byCategory} limit={6} />
            ) : (
              <Small>Loading…</Small>
            )}
          </Raised>
        </View>

        <LatestReceipts docs={docs.slice(0, 3)} />

        {summary ? (
          <Small style={{ textAlign: 'center' }}>
            {summary.receiptCount} receipts in {summary.monthLabel}
          </Small>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
