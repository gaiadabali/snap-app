import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type Overview } from '@/api';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import {
  Body,
  Card,
  Chip,
  ConfidenceDots,
  Divider,
  Figure,
  Label,
  RangeBar,
  Screen,
  Small,
} from '@/components/ui';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Tile } from '@/components/rich';
import { formatAud, space, usePalette } from '@/theme';

/**
 * Tax & BAS — a module, not the front door.
 *
 * This screen is deliberately behind a tab. It is dense, it uses ATO vocabulary
 * (1B, Simpler BAS, TD 2025/4), and most people will open it once a quarter.
 * Putting it on the home screen was a mistake: the two loudest complaints about
 * apps in this category are dashboards full of charts nobody asked for, and a
 * learning curve on first open. The home screen is now the timeline.
 *
 * The lead here is still GST AT RISK, because for the quarterly visit that IS
 * the question: how much can I not claim, and why.
 */
export default function TaxScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<Overview | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setData(await api().getOverview());
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

  if (!data) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Small>Loading position…</Small>
        </View>
      </Screen>
    );
  }

  const { bas, deductions } = data;
  const atRisk = Number(bas.gstAtRisk);
  const [benchLow, benchHigh] = data.benchmarkCommon ?? [0, 0];
  const benchMax = data.benchmarkMax ?? Math.max(benchHigh, deductions.estimateTotal) * 1.1;

  const labelNames: Record<string, string> = {
    D1: 'Vehicle',
    D2: 'Travel, meals & accommodation',
    D3: 'Clothing & laundry',
    D4: 'Self-education',
    D5: 'Other work expenses',
    D9: 'Gifts & donations',
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.lg,
          paddingBottom: space.xxxl,
          gap: space.lg,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.accent} />
        }
      >
        {/* ── Masthead ── */}
        <View style={{ gap: space.xs }}>
          <Label>{data.firmName ?? 'Direct'}</Label>
          <Figure size="h1">Tax &amp; BAS</Figure>
          <Small>
            {data.tenantName} · {data.profileLabel}
          </Small>
        </View>

        {/* ── The verdict, in the largest type on the page ── */}
        <Pressable accessibilityRole="button" onPress={() => router.back()}>
          <GradientHero tone={atRisk > 0 ? 'risk' : 'brand'}>
            <View style={{ gap: space.sm }}>
              <HeroLabel>{atRisk > 0 ? 'GST credits at risk' : 'All credits supported'}</HeroLabel>
              <HeroFigure>{formatAud(bas.gstAtRisk)}</HeroFigure>
              <HeroBody>
                {atRisk > 0
                  ? `${bas.atRiskCount} documents would fail an ATO check. You cannot claim a GST credit without a valid tax invoice.`
                  : 'Every claimed credit is backed by a valid tax invoice.'}
              </HeroBody>
            </View>
          </GradientHero>
        </Pressable>

        {/* ── Bento: the three numbers an accountant asks for ── */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Tile
            label="Claimable · 1B"
            value={formatAud(bas.gstClaimable)}
            tone="accent"
            hint="Backed by valid tax invoices"
          />
          <Tile label="Purchases" value={formatAud(bas.purchasesInclusive)} hint="Including GST" />
          <Tile
            wide
            label="Estimated deductions"
            value={formatAud(String(deductions.estimateTotal), { cents: false })}
            hint={`Typical for a ${data.profileLabel.toLowerCase()}: ${formatAud(String(benchLow), { cents: false })}–${formatAud(String(benchHigh), { cents: false })}`}
          />
        </View>

        {/* ── BAS position ── */}
        <Card>
          <View style={{ gap: space.md }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Label>BAS position</Label>
              <Chip tone="accent">Simpler BAS</Chip>
            </View>
            <Small>{bas.periodLabel}</Small>
            <Divider />
            <Row label="Purchases (incl GST)" value={formatAud(bas.purchasesInclusive)} />
            <Row
              label="GST on purchases · 1B"
              value={formatAud(bas.gstClaimable)}
              tone="accent"
              hint="Claimable — supported by valid tax invoices"
            />
            <Row
              label="Unclaimable GST"
              value={formatAud(bas.gstAtRisk)}
              tone="risk"
              hint="Excluded from 1B until the invoices are fixed"
            />
            <Divider />
            <Small>{bas.note}</Small>
          </View>
        </Card>

        {/* ── Deductions vs occupation benchmark ── */}
        <Card>
          <View style={{ gap: space.md }}>
            <Label>Estimated deductions this year</Label>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
              <Figure size="display" tone="accent">
                {formatAud(String(deductions.estimateTotal), { cents: false })}
              </Figure>
            </View>
            <RangeBar
              value={deductions.estimateTotal}
              low={benchLow}
              high={benchHigh}
              max={benchMax}
            />
            <Small>
              Typical for a {data.profileLabel.toLowerCase()}:{' '}
              {formatAud(String(benchLow), { cents: false })}–
              {formatAud(String(benchHigh), { cents: false })}. Your estimate sits{' '}
              {deductions.estimateTotal >= benchLow && deductions.estimateTotal <= benchHigh
                ? 'inside'
                : deductions.estimateTotal < benchLow
                  ? 'below'
                  : 'above'}{' '}
              that band.
            </Small>
            <Divider />
            {Object.entries(deductions.byLabel)
              .filter(([, v]) => v > 0)
              .sort(([, a], [, b]) => b - a)
              .map(([code, value]) => (
                <Row
                  key={code}
                  label={`${code} · ${labelNames[code] ?? code}`}
                  value={formatAud(String(value), { cents: false })}
                />
              ))}
          </View>
        </Card>

        {/* ── Caps applied, so the numbers are auditable ── */}
        <Card>
          <View style={{ gap: space.md }}>
            <Label>Caps applied</Label>
            <Small>
              Every figure above is computed from {data.ratesDetermination} at FY {data.ratesFy}
              rates. These are the limits that bound it.
            </Small>
            <Divider />
            <Row
              label="Cents-per-km ceiling"
              value={formatAud(String(deductions.caps.centsPerKmCeiling))}
              hint="5,000 work km is the legal maximum"
            />
            <Row
              label="Max vehicle decline / year"
              value={formatAud(String(deductions.caps.maxCarDeclinePerYear))}
              hint={`Car limit ${formatAud(String(deductions.caps.carCostLimit), { cents: false })} over 8 years`}
            />
            <Row
              label="Meals — reasonable daily total"
              value={formatAud(String(deductions.caps.mealDailyLimit))}
            />
            <Row
              label="Overtime meal, no receipt"
              value={formatAud(String(deductions.caps.overtimeMealNoReceiptMax))}
            />
            <Row
              label="Home laundry"
              value={`${formatAud(String(deductions.caps.homeLaundryPerWeek))} / week`}
            />
          </View>
        </Card>

        {/* ── Plan usage ── */}
        <Card>
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Label>This month</Label>
              <ConfidenceDots value={0.99} />
            </View>
            {/* Credits, not a plan. `scanQuota` was a monthly allowance and
                `planCode` named a tier; neither exists. A count of what was
                read is still true, and so is how it was extracted. This screen
                is behind BUSINESS_FEATURES_ENABLED and unreachable today —
                fixed now because it will be WRONG rather than merely stale the
                day that flag flips, and nobody will be looking at this line
                then. */}
            <Body>
              {data.entitlement.scansUsed} read this month ·{' '}
              {data.entitlement.realtime ? 'Realtime' : 'Batch'} extraction
            </Body>
            {data.firmName ? <Small>Managed by {data.firmName}</Small> : null}
          </View>
        </Card>

        <Small style={{ textAlign: 'center' }}>
          General information only — not tax advice. Rates FY {data.ratesFy} (
          {data.ratesDetermination}).
        </Small>
      </ScrollView>
    </Screen>
  );
}

function Row({
  label,
  value,
  tone = 'ink',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'ink' | 'accent' | 'risk' | 'muted';
  hint?: string;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: space.md,
        }}
      >
        <Body muted style={{ flexShrink: 1 }}>
          {label}
        </Body>
        <Figure tone={tone}>{value}</Figure>
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}
