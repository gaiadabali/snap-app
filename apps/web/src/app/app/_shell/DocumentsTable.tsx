'use client';

import { useMemo, useState } from 'react';
import type { DocumentView } from '@snap/api-contract';

import { Badge, Empty, Input, Money, Select, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate, reviewStatusLabel } from '@/lib/panels/format';

type Period = 'all' | 'this_month' | 'last_month' | 'quarter';

function inPeriod(issueDate: string, period: Period): boolean {
  if (period === 'all') return true;
  const now = new Date();
  const d = new Date(`${issueDate}T00:00:00`);
  if (period === 'this_month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  if (period === 'last_month') {
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === last.getFullYear() && d.getMonth() === last.getMonth();
  }
  // quarter
  const q = Math.floor(now.getMonth() / 3);
  const dq = Math.floor(d.getMonth() / 3);
  return d.getFullYear() === now.getFullYear() && dq === q;
}

function statusTone(status: DocumentView['reviewStatus']): 'neutral' | 'good' | 'warn' | 'risk' {
  switch (status) {
    case 'auto_accepted':
    case 'reviewed':
      return 'good';
    case 'needs_review':
      return 'warn';
    case 'rejected':
      return 'risk';
    default:
      return 'neutral';
  }
}

/**
 * The documents list — shared by the individual and business panels.
 *
 * Filtering is entirely client-side over a list already fetched whole. That
 * matches how the mobile app does it (`docs/PLAN.md` phase 5d: "search +
 * period filters ... over ~950 documents") rather than a server text-search
 * endpoint, which does not exist yet — hundreds of rows is comfortably within
 * what a browser can filter on a keystroke.
 */
export function DocumentsTable({
  documents,
  basePath,
  showTaxColumns,
  initialStatus = 'all',
}: {
  documents: DocumentView[];
  basePath: string;
  /** Business only — a personal document view must never mention GST or ABN. */
  showTaxColumns: boolean;
  /** Deep-linked from an overview card, e.g. "9 need review" -> straight to that filter. */
  initialStatus?: 'all' | DocumentView['reviewStatus'];
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | DocumentView['reviewStatus']>(initialStatus);
  const [period, setPeriod] = useState<Period>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents
      .filter((d) => status === 'all' || d.reviewStatus === status)
      .filter((d) => inPeriod(d.issueDate, period))
      .filter((d) => q === '' || d.supplierName.toLowerCase().includes(q) || d.category.toLowerCase().includes(q))
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1));
  }, [documents, query, status, period]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search supplier or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-[260px]"
          aria-label="Search documents"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value as never)} aria-label="Review status">
          <option value="all">All statuses</option>
          <option value="needs_review">Needs review</option>
          <option value="auto_accepted">Auto-accepted</option>
          <option value="reviewed">Reviewed</option>
          <option value="rejected">Rejected</option>
        </Select>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          <option value="all">All time</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
          <option value="quarter">This quarter</option>
        </Select>
        <span className="ml-auto text-[13px] text-[var(--color-ink-muted)]">
          {filtered.length} of {documents.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Empty
          title="No documents match"
          body="Try a different search, status or period — or clear the filters to see everything."
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-rule)]">
          <Table>
            <Thead>
              <Th>Date</Th>
              <Th>Supplier</Th>
              <Th>Category</Th>
              {showTaxColumns ? <Th>Tax invoice</Th> : null}
              <Th align="right">Amount</Th>
              {showTaxColumns ? <Th align="right">GST at risk</Th> : null}
              <Th>Status</Th>
              <Th>By</Th>
            </Thead>
            <tbody>
              {filtered.map((d) => (
                <Tr key={d.id} className="hover:bg-[var(--color-surface-alt)]">
                  <Td>
                    <a href={`${basePath}/${d.id}`} className="block text-[var(--color-ink)] hover:underline">
                      {formatDate(d.issueDate)}
                    </a>
                  </Td>
                  <Td>
                    <a href={`${basePath}/${d.id}`} className="hover:underline">
                      {d.visibility === 'private' ? '🔒 ' : ''}
                      {d.supplierName}
                    </a>
                  </Td>
                  <Td className="text-[var(--color-ink-muted)]">{d.category}</Td>
                  {showTaxColumns ? (
                    <Td>
                      {d.isTaxInvoice ? (
                        <Badge tone="good">Yes</Badge>
                      ) : (
                        <Badge tone="risk">No</Badge>
                      )}
                    </Td>
                  ) : null}
                  <Td align="right">
                    <Money amount={d.payableAmount} />
                  </Td>
                  {showTaxColumns ? (
                    <Td align="right">
                      {d.gstAtRisk && Number(d.gstAtRisk) > 0 ? (
                        <span className="text-[var(--color-risk)]">
                          <Money amount={d.gstAtRisk} />
                        </span>
                      ) : (
                        <span className="text-[var(--color-ink-faint)]">—</span>
                      )}
                    </Td>
                  ) : null}
                  <Td>
                    <Badge tone={statusTone(d.reviewStatus)}>{reviewStatusLabel(d.reviewStatus)}</Badge>
                  </Td>
                  <Td className="text-[var(--color-ink-muted)]">{d.capturedByName ?? '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
