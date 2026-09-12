import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { api, type DocumentView, type Invoice, type Overview, type SalesSummary } from '@/api';
import { CategoryBar, GradientHero, HeroBody, HeroFigure, HeroLabel, Raised, Tile } from '@/components/rich';
import { Body, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, space, usePalette } from '@/theme';

/**
 * Reports.
 *
 * Deliberately three questions, not a report builder: did I make money, where
 * did it go, and what do I owe. Everything here is derived from data already on
 * screen elsewhere, so nothing can disagree with the Receipts or Tax tabs.
 */
export default function ReportsScreen() {
  const p = usePalette();
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    // Business only. Including the personal workspace here counted a household
    // grocery run as a business expense and drove the profit figure far
    // negative — the workspace argument is not optional for anything that
    // claims to be a business report.
    void api().listDocuments('all', 'business').then(setDocs);
    void api().listInvoices('invoice').then(setInvoices);
    void api().getSales().then(setSales);
    void api().getOverview().then(setOverview);
  }, []);

  /**
   * The quarter this report covers.
   *
   * Both sides of the profit line must cover the same period. The fixture now
   * holds a year, and summing a year of expenses against a quarter of income
   * produced a loss of six figures on a profitable business.
   */
  const quarterStart = useMemo(() => {
    const now = new Date();
    const m = Math.floor(now.getMonth() / 3) * 3;
    return `${now.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`;
  }, []);

  const periodDocs = useMemo(
    () => docs.filter((d) => d.issueDate >= quarterStart),
    [docs, quarterStart],
  );

  // Income is recognised on issued invoices, ex-GST: GST collected is money
  // held for the ATO, never revenue.
  const incomeExGst = useMemo(
    () =>
      invoices
        .filter((i) => i.status !== 'draft' && i.issueDate >= quarterStart)
        .reduce((a, i) => a + Number(i.netAmount), 0),
    [invoices, quarterStart],
  );
  const spendInclGst = useMemo(
    () => periodDocs.reduce((a, d) => a + Number(d.payableAmount), 0),
    [periodDocs],
  );
  const spendExGst = useMemo(
    () => periodDocs.reduce((a, d) => a + Number(d.taxExclusiveAmount), 0),
    [periodDocs],
  );
  const profit = incomeExGst - spendExGst;

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of periodDocs)
      m.set(d.category, (m.get(d.category) ?? 0) + Number(d.payableAmount));
    return [...m.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [periodDocs]);

  const gstOwed = sales ? Number(sales.gstOnSales) - Number(overview?.bas.gstClaimable ?? '0') : 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}>
        <Figure size="h1">Reports</Figure>

        {/* ── Did I make money? ── */}
        <GradientHero tone={profit < 0 ? 'risk' : 'brand'}>
          <View style={{ gap: space.xs }}>
            <HeroLabel>Profit this quarter, ex GST</HeroLabel>
            <HeroFigure>{formatAud(profit.toFixed(2))}</HeroFigure>
            <HeroBody>
              {formatAud(incomeExGst.toFixed(2))} in · {formatAud(spendExGst.toFixed(2))} out
            </HeroBody>
          </View>
        </GradientHero>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Tile label="Invoiced" value={formatAud(incomeExGst.toFixed(2))} tone="accent" hint="Ex GST, issued" />
          <Tile label="Spent" value={formatAud(spendInclGst.toFixed(2))} hint="Incl GST, scanned" />
          <Tile
            wide
            label={gstOwed >= 0 ? 'GST owed to the ATO' : 'GST refund due'}
            value={formatAud(Math.abs(gstOwed).toFixed(2))}
            tone={gstOwed >= 0 ? 'risk' : 'accent'}
            hint={
              sales
                ? `1A ${formatAud(sales.gstOnSales)} collected − 1B ${formatAud(overview?.bas.gstClaimable ?? '0')} claimable`
                : undefined
            }
          />
        </View>

        {/* ── Where did it go? ── */}
        <Raised>
          <View style={{ gap: space.md }}>
            <Label>Where the money went</Label>
            {byCategory.length ? <CategoryBar parts={byCategory} /> : <Small>No spending yet.</Small>}
            <Divider />
            {byCategory.slice(0, 6).map((c) => (
              <View
                key={c.category}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: space.md,
                }}
              >
                <Body muted style={{ flexShrink: 1 }}>
                  {c.category}
                </Body>
                <Figure>{formatAud(c.amount.toFixed(2))}</Figure>
              </View>
            ))}
          </View>
        </Raised>

        {/* ── What is still owed to me? ── */}
        {sales ? (
          <Raised accent={Number(sales.overdue) > 0 ? p.risk : undefined}>
            <View style={{ gap: space.sm }}>
              <Label>Owed to you</Label>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <Body muted>Outstanding</Body>
                <Figure size="h2">{formatAud(sales.outstanding)}</Figure>
              </View>
              <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}
              >
                <Body muted>Overdue</Body>
                <Figure tone={Number(sales.overdue) > 0 ? 'risk' : 'ink'}>
                  {formatAud(sales.overdue)}
                </Figure>
              </View>
              <Divider />
              <Small>
                Chasing overdue invoices is usually worth more per hour than any deduction on the
                tax screen.
              </Small>
            </View>
          </Raised>
        ) : null}

        <Small style={{ textAlign: 'center' }}>
          Derived from the same figures as Receipts and Tax — nothing here is calculated twice.
        </Small>
      </ScrollView>
    </Screen>
  );
}
