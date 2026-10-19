import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AnalyticsRange, type AnalyticsSummary } from '@/api';
import { BarSeries, CategoryBars, CategoryRing, RingLegend } from '@/components/charts';
import { Raised, Tile } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';
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

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {RANGES.map((r) => (
            <Chip key={r.key} selected={range === r.key} onPress={() => setRange(r.key)}>
              {r.label}
            </Chip>
          ))}
        </View>

        {data === null ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={p.accent} />
          </View>
        ) : (
          <>
            {/* Headline: the total, and whether it is unusual. */}
            <Raised style={{ gap: space.md }}>
              <View style={{ gap: 2 }}>
                <Label>{point ? point.label : data.rangeLabel}</Label>
                <Figure size="display">{formatAud(point ? point.value : data.total)}</Figure>
                {point ? (
                  <Small>
                    {point.partial ? 'Still in progress · ' : ''}Tap the bar again to clear
                  </Small>
                ) : change === null ? (
                  <Small>{data.receiptCount} receipts · no earlier period to compare</Small>
                ) : (
                  <Small>
                    <Small muted={false} style={{ color: up ? p.risk : p.accent, fontWeight: '700' }}>
                      {up ? '▲' : '▼'} {Math.abs(Math.round(change * 100))}%
                    </Small>
                    {`  vs ${formatAud(data.previousTotal, { cents: false })} the period before`}
                  </Small>
                )}
              </View>

              <BarSeries points={data.series} onSelect={setSelected} />

              <Divider />

              <View style={{ flexDirection: 'row', gap: space.lg }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Label>Average</Label>
                  <Figure size="h2">{formatAud(data.average, { cents: false })}</Figure>
                  <Small>per {range === 'month' ? 'week' : 'month'}</Small>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Label>Receipts</Label>
                  <Figure size="h2">{String(data.receiptCount)}</Figure>
                  <Small>captured in range</Small>
                </View>
              </View>
            </Raised>

            {/* Where it went. */}
            <View style={{ gap: space.sm }}>
              <Label>By category</Label>
              <Raised style={{ gap: space.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
                  <CategoryRing
                    parts={data.byCategory}
                    centreLabel="Total"
                    centreValue={formatAud(data.total, { cents: false })}
                  />
                  <RingLegend parts={data.byCategory} />
                </View>
                <Divider />
                <CategoryBars parts={data.byCategory} />
              </Raised>
            </View>

            {/* Who it went to. */}
            <View style={{ gap: space.sm }}>
              <Label>Top merchants</Label>
              <Raised style={{ padding: 0 }}>
                {data.topMerchants.map((m, i) => (
                  <View key={m.name}>
                    {i > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        paddingHorizontal: space.lg,
                        paddingVertical: 12,
                      }}
                    >
                      <Figure size="small" tone="muted" style={{ width: 18 }}>
                        {String(i + 1)}
                      </Figure>
                      <View style={{ flex: 1, gap: 1 }}>
                        <Body strong numberOfLines={1}>
                          {m.name}
                        </Body>
                        <Small>
                          {m.count} visit{m.count === 1 ? '' : 's'}
                        </Small>
                      </View>
                      <Figure size="h2">{formatAud(m.total)}</Figure>
                    </View>
                  </View>
                ))}
              </Raised>
            </View>

            {data.largest ? (
              <Raised style={{ gap: 4 }}>
                <Label>Largest single receipt</Label>
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
                >
                  <Body strong numberOfLines={1} style={{ flex: 1 }}>
                    {data.largest.name}
                  </Body>
                  <Figure size="h1">{formatAud(data.largest.amount)}</Figure>
                </View>
                <Small>{formatShortDate(data.largest.date)}</Small>
              </Raised>
            ) : null}

            {/* Business only. Personal spending has no GST position at all. */}
            {isBusiness && data.gstClaimable !== null ? (
              <View style={{ gap: space.sm }}>
                <Label>GST in this period</Label>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
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
              </View>
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
