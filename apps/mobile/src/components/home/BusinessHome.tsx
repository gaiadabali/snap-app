import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type DocumentView, type Overview, type SalesSummary } from '@/api';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, space, usePalette } from '@/theme';
import { WorkspaceSwitch } from '@/workspace';

import { Action, AttentionRow, LatestReceipts, StatCard, greeting, sumMoney } from './shared';

/**
 * Business home: what needs your attention, and the way to act on it.
 *
 * The full receipt list used to live here, which meant the screen you open
 * twenty times a day was mostly rows you had already dealt with. The list is
 * at /receipts; home answers the three questions that actually recur — what
 * have I spent, what is unresolved, who owes me — and gets out of the way.
 */
export default function BusinessHome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [d, o, s] = await Promise.all([
      api().listDocuments('all', 'business'),
      api().getOverview(),
      api().getSales(),
    ]);
    setDocs(d);
    setOverview(o);
    setSales(s);
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

  const all = docs ?? [];
  const recent = useMemo(
    () => [...all].sort((a, b) => b.issueDate.localeCompare(a.issueDate)).slice(0, 3),
    [all],
  );
  // The hero counts the BAS quarter, which is what the figure beside it means.
  // The fixture now holds a year, so summing everything would overstate it.
  const quarterDocs = useMemo(() => {
    const now = new Date();
    const start = `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;
    return all.filter((d) => d.issueDate >= start);
  }, [all]);
  const quarterTotal = useMemo(() => sumMoney(quarterDocs.map((d) => d.payableAmount)), [quarterDocs]);
  const needsReview = all.filter((d) => d.reviewStatus === 'needs_review').length;

  const atRisk = overview?.bas.gstAtRisk ?? '0';
  const overdue = Number(sales?.overdue ?? '0');
  const hasAttention = needsReview > 0 || Number(atRisk) > 0;

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
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Small>{greeting()}</Small>
              {IS_DEMO ? <Chip tone="warn">Demo</Chip> : null}
            </View>
            <Figure size="h1">{overview?.tenantName ?? 'Snap Apps'}</Figure>
          </View>
          <WorkspaceSwitch />
        </View>

        <View style={{ paddingHorizontal: space.lg }}>
          <GradientHero>
            <View style={{ gap: space.xs }}>
              <HeroLabel>Captured this quarter</HeroLabel>
              <HeroFigure>{formatAud(quarterTotal)}</HeroFigure>
              <HeroBody>
                {quarterDocs.length} receipt{quarterDocs.length === 1 ? '' : 's'} ·{' '}
                {formatAud(overview?.bas.gstClaimable ?? '0')} GST to claim
              </HeroBody>
            </View>
          </GradientHero>
        </View>

        {/* Four shortcuts. Scan is not among them — it is the middle tab. */}
        <View style={{ flexDirection: 'row', paddingHorizontal: space.lg, gap: space.sm }}>
          <Action icon="receipt" label="Receipts" href="/receipts" />
          <Action icon="chart" label="Analytics" href="/analytics" />
          <Action icon="tag" label="Invoice" href="/invoice/new" />
          <Action icon="upload" label="Bills" href="/bills" />
        </View>

        {/* Only shown when there is something to do. An empty card is noise. */}
        {hasAttention ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Label>Needs your attention</Label>
            <Raised style={{ padding: 0 }}>
              {needsReview > 0 ? (
                <AttentionRow
                  first
                  icon="search"
                  title="Receipts to check"
                  detail="Confirm what was read from the photo"
                  value={String(needsReview)}
                  tone="warn"
                  href="/receipts?filter=review"
                />
              ) : null}
              {Number(atRisk) > 0 ? (
                <AttentionRow
                  first={needsReview === 0}
                  icon="alert"
                  title="GST credits at risk"
                  detail={`${overview?.bas.atRiskCount ?? 0} missing a valid tax invoice`}
                  value={formatAud(atRisk)}
                  tone="risk"
                  href="/tax"
                />
              ) : null}
            </Raised>
          </View>
        ) : null}

        {/* Money in, money back. The two figures a business checks by habit. */}
        <View style={{ flexDirection: 'row', paddingHorizontal: space.lg, gap: space.sm }}>
          <StatCard
            label={overdue > 0 ? 'Overdue' : 'Owed to you'}
            value={formatAud(overdue > 0 ? sales?.overdue : sales?.outstanding, { cents: false })}
            hint={
              overdue > 0
                ? `${formatAud(sales?.outstanding, { cents: false })} outstanding`
                : 'Across open invoices'
            }
            tone={overdue > 0 ? 'risk' : 'ink'}
            href="/invoices"
          />
          <StatCard
            label="Deductions"
            value={formatAud(String(overview?.deductions.estimateTotal ?? 0), { cents: false })}
            hint={`Estimate · FY${overview?.ratesFy ?? ''}`}
            tone="accent"
            href="/tax"
          />
        </View>

        <LatestReceipts docs={recent} />

        {overview ? (
          <Small style={{ textAlign: 'center' }}>
            {/* No quota to be "of", and nothing is "unlimited" — a credit
                buys each read. Both branches described a plan. */}
            {`${overview.entitlement.scansUsed} read this month`}
          </Small>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
