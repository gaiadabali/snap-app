import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AnalyticsRange, type AnalyticsSummary } from '@/api';
import { BarSeries, CategoryBars, CategoryRing, RingLegend } from '@/components/charts';
import { Tile } from '@/components/rich';
import { Figure, LedgerRow, Screen, Section, Segmented, Small } from '@/components/ui';
import { formatAud, formatShortDate, numeric, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

/**
 * Analytics: where the money went, and whether that is different from usual.
 *
 * Deliberately the same page for both workspaces, because the questions are
 * the same — how much, on what, to whom, and up or down on last time. Only the
 * GST row is business-only, and it is absent rather than zeroed in personal:
 * personal spending has no GST position, and showing $0.00 would imply it has
 * one that happens to be nil.
 *
 * Every figure comes from `getAnalytics`, which the server will compute in
 * production. Nothing here aggregates.
 *
 * The page is a reading, not a stack of cards: the period total is one large
 * light figure with its change beside it in mono, the chart sits directly on
 * the ground, and the lists are ledger rows. Spending going up is a `warn`,
 * not red — red is for money already at risk, and a busier month is not that.
 */

const RANGES: Array<{ key: AnalyticsRange; label: string }> = [
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: '3 months' },
  { key: 'year', label: 'Year' },
];

export default function AnalyticsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { workspace, isBusiness } = useWorkspace();
  const [range, setRange] = useState<AnalyticsRange>('month');
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async () => {
    setData(await api().getAnalytics(workspace, range));
  }, [workspace, range]);

  useFocusEffect(
    useCallback(() => {
      setData(null);
      setSelected(null);
      void load();
    }, [load]),
  );

  const change = data?.changePct ?? null;
  const up = (change ?? 0) > 0;
  const point = data && selected !== null ? data.series[selected] : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxl + insets.bottom,
          gap: space.lg,
        }}
      >
        <WorkspaceSwitch />

        <Segmented
          options={RANGES.map((r) => ({ value: r.key, label: r.label }))}
          value={range}
          onChange={setRange}
        />

        {data === null ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={p.accent} />
          </View>
        ) : (
          <>
            {/* Headline: the total, and whether it is unusual. */}
            <View style={{ gap: 4, paddingTop: space.sm }}>
              <Text style={[type.label, { color: p.inkMuted }]}>
                {point ? point.label : data.rangeLabel}
              </Text>
              <Figure size="display">{formatAud(point ? point.value : data.total)}</Figure>
              {point ? (
                <Text style={[type.mono, { color: p.inkMuted }]}>
                  {point.partial ? 'Still in progress · ' : ''}Tap the bar again to clear
                </Text>
              ) : change === null ? (
                <Text style={[type.mono, { color: p.inkMuted }]}>
                  {data.receiptCount} receipts · no earlier period to compare
                </Text>
              ) : (
                <Text style={[type.mono, numeric, { color: p.inkMuted }]}>
                  <Text style={[type.mono, numeric, { color: up ? p.warn : p.good }]}>
                    {up ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}%
                  </Text>
                  {`  vs ${formatAud(data.previousTotal, { cents: false })} the period before`}
                </Text>
              )}
            </View>

            <BarSeries points={data.series} onSelect={setSelected} />

            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Tile
                label="Average"
                value={formatAud(data.average, { cents: false })}
                hint={`per ${range === 'month' ? 'week' : 'month'}`}
              />
              <Tile
                label="Receipts"
                value={String(data.receiptCount)}
                hint="captured in range"
              />
            </View>

            {/* Where it went. The ring answers "how is it split"; the bars
                under it are the only place a budget shows up. */}
            <Section label="By category" style={{ marginTop: space.lg }}>
              <View style={{ gap: space.xl, paddingTop: space.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
                  <CategoryRing
                    parts={data.byCategory}
                    size={148}
                    centreLabel="Total"
                    centreValue={formatAud(data.total, { cents: false })}
                  />
                  <RingLegend parts={data.byCategory} />
                </View>
                <CategoryBars parts={data.byCategory} />
              </View>
            </Section>

            {/* Who it went to. */}
            <Section label="Top merchants" style={{ marginTop: space.lg }} rule={false}>
              {data.topMerchants.map((m, i) => (
                <LedgerRow
                  key={m.name}
                  first={i === 0}
                  gutter={String(i + 1).padStart(2, '0')}
                  title={m.name}
                  note={`${m.count} visit${m.count === 1 ? '' : 's'}`}
                  figure={formatAud(m.total)}
                />
              ))}
            </Section>

            {data.largest ? (
              <Section label="Largest single receipt" style={{ marginTop: space.lg }} rule={false}>
                <LedgerRow
                  first
                  gutter={formatShortDate(data.largest.date)}
                  title={data.largest.name}
                  figure={formatAud(data.largest.amount)}
                />
              </Section>
            ) : null}

            {/* Business only. Personal spending has no GST position at all. */}
            {isBusiness && data.gstClaimable !== null ? (
              <Section label="GST in this period" style={{ marginTop: space.lg }}>
                <View style={{ flexDirection: 'row', gap: space.lg }}>
                  <Tile
                    label="Claimable"
                    value={formatAud(data.gstClaimable)}
                    hint="Backed by a valid tax invoice"
                    tone="accent"
                  />
                  <Tile
                    label="At risk"
                    value={formatAud(data.gstAtRisk)}
                    hint="Missing something the ATO requires"
                    tone={Number(data.gstAtRisk) > 0 ? 'risk' : 'default'}
                  />
                </View>
              </Section>
            ) : null}

            <Small style={{ textAlign: 'center' }}>
              {isBusiness ? 'Business' : 'Personal'} workspace · {data.rangeLabel.toLowerCase()}
            </Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
