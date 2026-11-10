import type { InvoiceIssuerChange } from '@snap/api-contract';

import { Badge, Button, Card, Empty, SectionTitle, Select, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import { getGstReport, getInvoiceIssuer } from '../../_data/governance';

import { RefusalPanel } from '../_components/RefusalPanel';
import { DecisionButtons } from './_components/DecisionButtons';
import { DownloadCsv } from './_components/DownloadCsv';
import { IssuerForm } from './_components/IssuerForm';

export const metadata = { title: 'Invoicing · Snap Apps admin' };

/** Australian BAS quarters, named by the financial year (ending 30 June) they fall in. */
function recentQuarters(now: Date, count: number): Array<{ value: string; label: string }> {
  const sydney = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(now);
  const year = Number(sydney.slice(0, 4));
  const month = Number(sydney.slice(5, 7));
  // The quarter within the FY: Jul-Sep 1, Oct-Dec 2, Jan-Mar 3, Apr-Jun 4.
  let fy = month >= 7 ? year + 1 : year;
  let q = month >= 7 ? Math.floor((month - 7) / 3) + 1 : Math.floor((month - 1) / 3) + 3;
  const months = ['Jul-Sep', 'Oct-Dec', 'Jan-Mar', 'Apr-Jun'];
  const out: Array<{ value: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const calendarYear = q <= 2 ? fy - 1 : fy;
    out.push({ value: `FY${fy}-Q${q}`, label: `FY${fy} Q${q} (${months[q - 1]} ${calendarYear})` });
    q -= 1;
    if (q === 0) {
      q = 4;
      fy -= 1;
    }
  }
  return out;
}

const aud = (cents: number) => `${cents < 0 ? '-' : ''}A$${(Math.abs(cents) / 100).toFixed(2)}`;

function ChangeLine({ c }: { c: InvoiceIssuerChange }) {
  return (
    <div className="text-[13px] leading-relaxed">
      <div className="font-semibold">{c.legalName}</div>
      <div>
        ABN {c.abn ?? 'none yet'} · {c.gstRegistered ? 'GST registered' : 'not GST registered'}
      </div>
      <div className="whitespace-pre-line">{c.address}</div>
      <div>{c.email}</div>
    </div>
  );
}

export default async function InvoicingPage({ searchParams }: { searchParams: Promise<{ quarter?: string }> }) {
  const { quarter } = await searchParams;
  const quarters = recentQuarters(new Date(), 8);
  const selected = quarters.find((q) => q.value === quarter)?.value ?? null;

  const [issuer, report] = await Promise.all([
    getInvoiceIssuer(),
    selected ? getGstReport({ quarter: selected }) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Invoicing"
        title="Receipts, tax invoices and GST"
        lede="Who issues credit receipts, and the quarterly GST export. Until an issuer with a valid ABN is approved and GST registered, buyers get plain receipts with no ABN or GST line."
      />

      {!issuer.allowed ? (
        <RefusalPanel capability="manage_platform_settings" status={issuer.status} message={issuer.message} />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[16px] font-bold">Issuer in force</h3>
              <Badge tone={issuer.data.mode === 'tax_invoice' ? 'good' : 'neutral'}>
                {issuer.data.mode === 'tax_invoice' ? 'Issuing tax invoices' : 'Issuing receipts'}
              </Badge>
            </div>
            <div className="mt-3">
              {issuer.data.current ? (
                <ChangeLine c={issuer.data.current} />
              ) : (
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  None approved yet. Buyers get receipts without an issuer.
                </p>
              )}
            </div>
          </Card>

          {issuer.data.pending ? (
            <Card tone="accent">
              <h3 className="text-[16px] font-bold">Waiting for approval</h3>
              <div className="mt-3">
                <ChangeLine c={issuer.data.pending} />
              </div>
              <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">
                Proposed by {issuer.data.pending.proposedByLabel ?? 'a former admin'}: {issuer.data.pending.reason}. A
                different admin has to approve it.
              </p>
              <DecisionButtons id={issuer.data.pending.id} />
            </Card>
          ) : null}

          <IssuerForm current={issuer.data.current} blocked={issuer.data.pending !== null} />

          <Card>
            <h3 className="text-[16px] font-bold">History</h3>
            <div className="mt-4 overflow-x-auto">
              {issuer.data.history.length === 0 ? (
                <Empty title="No changes yet" />
              ) : (
                <Table>
                  <Thead>
                    <Th>Proposed</Th>
                    <Th>Issuer</Th>
                    <Th>By</Th>
                    <Th>Decision</Th>
                  </Thead>
                  <tbody>
                    {issuer.data.history.map((c) => (
                      <Tr key={c.id}>
                        <Td>{c.proposedAt.slice(0, 10)}</Td>
                        <Td>
                          {c.legalName}, ABN {c.abn ?? 'none'}, {c.gstRegistered ? 'GST' : 'no GST'}
                        </Td>
                        <Td>{c.proposedByLabel ?? '-'}</Td>
                        <Td>
                          {c.status}
                          {c.decidedByLabel ? ` by ${c.decidedByLabel}` : ''}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        </>
      )}

      <Card>
        <h3 className="text-[16px] font-bold">GST report</h3>
        <p className="mt-1 max-w-[70ch] text-[13px] text-[var(--color-ink-muted)]">
          Documents issued in an Australian quarter (Sydney dates), with sales, GST collected and refunds. Google Play
          sales are listed apart: Google pays the GST on those.
        </p>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Quarter
            <Select name="quarter" defaultValue={selected ?? ''}>
              <option value="" disabled>
                Choose a quarter
              </option>
              {quarters.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="secondary">
            Show report
          </Button>
        </form>

        {report && !report.allowed ? (
          <div className="mt-4">
            <RefusalPanel capability="manage_billing" status={report.status} message={report.message} />
          </div>
        ) : null}
        {report && report.allowed ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="text-[13px]">
              {report.data.from} to {report.data.to}: {report.data.totals.documentCount} documents. Sales{' '}
              {aud(report.data.totals.salesCents)}, GST collected {aud(report.data.totals.salesGstCents)}, refunds{' '}
              {aud(report.data.totals.refundsCents)}. Google Play sales {aud(report.data.totals.playSalesCents)} (
              {report.data.totals.playSalesCount}), GST paid by Google.
            </div>
            <div>
              <DownloadCsv filename={report.data.filename} csv={report.data.csv} />
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
