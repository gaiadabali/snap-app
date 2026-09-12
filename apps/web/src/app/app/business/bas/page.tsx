import Link from 'next/link';

import { Badge, Card, Empty, Money, SectionTitle, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import { getOverview, listDocuments } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'BAS & GST' };

const FAILURE_LABEL: Record<string, string> = {
  supplier_abn_missing: 'Missing supplier ABN',
  supplier_abn_invalid: "Supplier ABN fails the ATO checksum",
  buyer_abn_required_over_1000: 'Needs your ABN on it (over $1,000)',
  not_marked_tax_invoice: "Doesn't say 'Tax Invoice'",
};

/** A failure code the server sent that this screen has no copy for yet — shown
 *  as a plain phrase rather than a shouting badge with an underscore in it. */
function labelFor(code: string): string {
  return FAILURE_LABEL[code] ?? code.replace(/_/g, ' ');
}

export default async function BasPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const [overview, atRisk] = await Promise.all([
    getOverview(workspace.id),
    listDocuments(workspace.id, 'at_risk'),
  ]);
  const { bas } = overview;

  return (
    <div className="flex flex-col gap-8">
      <SectionTitle
        as="h1"
        eyebrow={bas.periodLabel}
        title="BAS position"
        lede="Simpler BAS: G1, 1A and 1B. Label 1B only includes purchases backed by a valid tax invoice — everything else accrues here instead of to your claim."
      />

      <Card tone="accent" className="border-2 border-[var(--color-risk)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-risk)]">
              GST you cannot claim this quarter
            </div>
            <div className="mt-1 text-5xl font-bold tabular text-[var(--color-risk)]">
              <Money amount={bas.gstAtRisk} />
            </div>
            <p className="mt-2 max-w-[52ch] text-[14px] text-[var(--color-ink-muted)]">
              {bas.atRiskCount} receipt{bas.atRiskCount === 1 ? '' : 's'} this quarter{' '}
              {bas.atRiskCount === 1 ? 'is' : 'are'} missing what the ATO requires to treat it as a valid tax
              invoice — most often the supplier&apos;s ABN.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[13px] text-[var(--color-ink-muted)]">GST claimable instead</div>
            <div className="text-2xl font-bold tabular text-[var(--color-good)]">
              <Money amount={bas.gstClaimable} />
            </div>
          </div>
        </div>
      </Card>

      {atRisk.length === 0 ? (
        <Empty
          title="Nothing at risk this quarter"
          body="Every purchase so far is backed by a valid tax invoice, so 1B is not leaving anything on the table."
        />
      ) : (
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">The receipts behind that figure</h3>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Th>Date</Th>
                <Th>Supplier</Th>
                <Th align="right">Paid</Th>
                <Th align="right">GST at risk</Th>
                <Th>What&apos;s missing</Th>
                <Th></Th>
              </Thead>
              <tbody>
                {atRisk.map((d) => (
                  <Tr key={d.id}>
                    <Td>{formatDate(d.issueDate)}</Td>
                    <Td>{d.supplierName}</Td>
                    <Td align="right">
                      <Money amount={d.payableAmount} />
                    </Td>
                    <Td align="right">
                      <span className="text-[var(--color-risk)]">
                        <Money amount={d.gstAtRisk ?? '0'} />
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {d.complianceFailures.length === 0 ? (
                          <Badge tone="neutral">Under review</Badge>
                        ) : (
                          d.complianceFailures.map((f) => (
                            <Badge key={f} tone="warn">
                              {labelFor(f)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td>
                      <Link
                        href={`/app/business/documents/${d.id}`}
                        className="font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        Review &amp; fix →
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}
