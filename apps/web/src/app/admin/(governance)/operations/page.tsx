import { Badge, Card, Empty, SectionTitle, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import { getQueueStats, getRetentionStatus } from '../../_data/governance';

import { NotWired } from '../_components/NotWired';
import { RefusalPanel } from '../_components/RefusalPanel';
import { ReextractionForm } from './_components/ReextractionForm';

export const metadata = { title: 'Operations · Snap Apps admin' };

export default async function OperationsPage() {
  const [queues, retention] = await Promise.all([getQueueStats(), getRetentionStatus()]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Operations"
        title="What the running system is doing"
        lede="Queue depth by job kind, per-tenant retention exposure, and triggering a re-extraction — the operational reads and writes the admin plane actually backs today."
      />

      <Card>
        <h3 className="text-[16px] font-bold">Queues</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          <code>GET /v1/admin/operations/queue</code> — pending/locked/stalled counts and the oldest
          unlocked pending job's age, per job kind.
        </p>
        <div className="mt-4 overflow-x-auto">
          {!queues.allowed ? (
            <RefusalPanel capability="view_analytics" status={queues.status} message={queues.message} />
          ) : queues.data.length === 0 ? (
            <Empty title="No queues reporting" />
          ) : (
            <Table>
              <Thead>
                <Th>Kind</Th>
                <Th align="right">Pending</Th>
                <Th align="right">Locked</Th>
                <Th align="right">Stalled (max attempts)</Th>
                <Th align="right">Oldest pending</Th>
              </Thead>
              <tbody>
                {queues.data.map((q) => (
                  <Tr key={q.kind}>
                    <Td className="font-semibold">{q.kind}</Td>
                    <Td align="right" className="tabular">
                      {q.pending.toLocaleString('en-AU')}
                    </Td>
                    <Td align="right" className="tabular">
                      {q.locked.toLocaleString('en-AU')}
                    </Td>
                    <Td align="right">
                      <span className={q.stalledAtMax > 0 ? 'tabular font-semibold text-[var(--color-risk)]' : 'tabular'}>
                        {q.stalledAtMax.toLocaleString('en-AU')}
                      </span>
                    </Td>
                    <Td align="right" className="tabular">
                      {q.oldestPendingAge ?? '—'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <NotWired title="Worker health, job failures &amp; retries, storage usage, rate limits">
        No endpoint reports worker heartbeats, job-failure buckets, bucket storage sizes, or rate-limit
        usage. None of these are read anywhere on the admin plane today.
      </NotWired>

      <Card>
        <h3 className="text-[16px] font-bold">Re-extraction</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          <code>POST /v1/admin/operations/reextraction</code> re-queues ONE capture. There is no bulk
          replay endpoint — no "one tenant", "everything a model touched", or "the whole platform" scope
          exists server-side, so there is nothing to preview a blast radius for beyond the single document
          named below.
        </p>
        <div className="mt-4">
          <ReextractionForm />
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Retention exposure by tenant</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          <code>GET /v1/admin/operations/retention</code> — the oldest document on file per tenant against
          its retention window. This is exposure, not a purge job log: there is no endpoint reporting past
          purge runs, and no endpoint to trigger a purge on demand — retention purge happens on its own
          schedule and cannot be forced from here.
        </p>
        <div className="mt-4 overflow-x-auto">
          {!retention.allowed ? (
            <RefusalPanel capability="view_analytics" status={retention.status} message={retention.message} />
          ) : retention.data.length === 0 ? (
            <Empty title="No tenants to report" />
          ) : (
            <Table>
              <Thead>
                <Th>Tenant</Th>
                <Th align="right">Oldest document</Th>
                <Th align="right">Retention window</Th>
              </Thead>
              <tbody>
                {retention.data.map((r) => (
                  <Tr key={r.tenantId}>
                    <Td className="font-semibold">{r.name}</Td>
                    <Td align="right" className="tabular">
                      {r.oldestDocumentIssueDate ?? '—'}
                    </Td>
                    <Td align="right">
                      {r.retentionMonths === null ? (
                        <Badge tone="neutral">unset</Badge>
                      ) : (
                        <span className="tabular">{r.retentionMonths}mo</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>

      <NotWired title="Manual retention purge">
        Only the read above exists. There is no endpoint to preview or trigger a purge on demand — the
        nightly job runs on its own schedule and this console cannot force, delay, or inspect its history.
      </NotWired>
    </div>
  );
}
