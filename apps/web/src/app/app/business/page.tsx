import Link from 'next/link';

import { Badge, Card, Empty, Money, SectionTitle, Stat } from '@/design/primitives';
import { getOverview, listDocuments } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'Overview · Business' };

export default async function BusinessOverviewPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const [overview, needsReview] = await Promise.all([
    getOverview(workspace.id),
    listDocuments(workspace.id, 'needs_review'),
  ]);

  const { bas } = overview;
  const atRisk = Number(bas.gstAtRisk) > 0;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        as="h1"
        eyebrow={`${overview.tenantName}${overview.tenantAbn ? ` · ABN ${overview.tenantAbn}` : ''}`}
        title={bas.periodLabel}
        lede={overview.profileLabel !== 'No occupation set' ? overview.profileLabel : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Purchases this quarter" value={<Money amount={bas.purchasesInclusive} />} />
        </Card>
        <Card>
          <Stat label="GST claimable" value={<Money amount={bas.gstClaimable} />} tone="good" />
        </Card>
        <Card tone={atRisk ? 'accent' : 'surface'}>
          <Stat
            label="GST you cannot claim"
            value={<Money amount={bas.gstAtRisk} />}
            tone={atRisk ? 'risk' : 'neutral'}
            hint={
              atRisk ? (
                <Link href="/app/business/bas" className="text-[var(--color-risk)] hover:underline">
                  {bas.atRiskCount} receipts missing what a tax invoice needs →
                </Link>
              ) : (
                'Every purchase this quarter is backed by a valid tax invoice'
              )
            }
          />
        </Card>
        <Card tone={needsReview.length > 0 ? 'accent' : 'surface'}>
          <Stat
            label="Needs review"
            value={needsReview.length}
            tone={needsReview.length > 0 ? 'warn' : 'neutral'}
            hint={
              needsReview.length > 0 ? (
                <Link href="/app/business/documents?status=needs_review" className="text-[var(--color-accent)] hover:underline">
                  Review now →
                </Link>
              ) : (
                'All caught up'
              )
            }
          />
        </Card>
      </div>

      <Card>
        <p className="text-[13px] text-[var(--color-ink-muted)]">{bas.note}</p>
        <p className="mt-1 text-[12px] text-[var(--color-ink-faint)]">
          A tax invoice is required at ${bas.thresholds.taxInvoice} and up; the buyer&apos;s ABN must also appear at $
          {bas.thresholds.buyerAbn} and up.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Entitlement</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-[13px]">
            <dt className="text-[var(--color-ink-muted)]">Plan</dt>
            <dd className="text-right font-medium capitalize">{overview.entitlement.planCode}</dd>
            <dt className="text-[var(--color-ink-muted)]">Scans remaining</dt>
            <dd className="text-right font-medium">
              {overview.entitlement.scansRemaining === null ? 'Unlimited' : overview.entitlement.scansRemaining}
              {overview.entitlement.scanQuota !== null ? ` of ${overview.entitlement.scanQuota}` : ''}
            </dd>
            <dt className="text-[var(--color-ink-muted)]">Seats</dt>
            <dd className="text-right font-medium">
              {overview.entitlement.seatsUsed} of {overview.entitlement.seatLimit}
            </dd>
            <dt className="text-[var(--color-ink-muted)]">Realtime scans</dt>
            <dd className="text-right">
              <Badge tone={overview.entitlement.realtime ? 'good' : 'neutral'}>
                {overview.entitlement.realtime ? 'On' : 'Batched'}
              </Badge>
            </dd>
          </dl>
          <Link href="/app/plan" className="mt-3 inline-block text-[13px] font-medium text-[var(--color-accent)] hover:underline">
            Manage plan →
          </Link>
        </Card>

        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Occupation benchmark</h3>
          {overview.benchmarkCommon && overview.benchmarkCommon.length > 0 ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              Similar businesses typically claim between{' '}
              <span className="font-medium text-[var(--color-ink)]">${overview.benchmarkCommon[0]?.toLocaleString()}</span> and{' '}
              <span className="font-medium text-[var(--color-ink)]">${overview.benchmarkCommon[1]?.toLocaleString()}</span> a
              year{overview.benchmarkMax ? `, up to $${overview.benchmarkMax.toLocaleString()}` : ''}.
            </p>
          ) : (
            <Empty
              title="No occupation set"
              body="Set one in Settings so deduction estimates can be checked against a benchmark for your trade."
            />
          )}
          <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
            {overview.ratesFy} rates, {overview.ratesDetermination}.
          </p>
        </Card>
      </div>
    </div>
  );
}
