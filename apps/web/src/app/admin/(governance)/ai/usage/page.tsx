import { Badge, Card, Empty, Money, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import { getAiUsage } from '../../../_data/governance';

import { NotWired } from '../../_components/NotWired';
import { RefusalPanel } from '../../_components/RefusalPanel';

export const metadata = { title: 'Usage & spend · Snap Apps admin' };

export default async function UsagePage() {
  const gated = await getAiUsage();

  return (
    <div className="flex flex-col gap-6">
      {!gated.allowed ? (
        <RefusalPanel capability="manage_ai_config" status={gated.status} message={gated.message} />
      ) : (
        <Card>
          <h3 className="text-[16px] font-bold">Extraction runs by engine/model, last 30 days</h3>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            <code>GET /v1/admin/ai/usage</code> — real cost and latency figures, aggregated per
            engine/model. Nothing here is sliced by tenant; the server does not attribute AI cost to a
            tenant anywhere yet.
          </p>
          <div className="mt-4 overflow-x-auto">
            {gated.data.length === 0 ? (
              <Empty title="No extraction runs in the last 30 days" />
            ) : (
              <Table>
                <Thead>
                  <Th>Engine</Th>
                  <Th>Model</Th>
                  <Th align="right">Runs</Th>
                  <Th align="right">Succeeded</Th>
                  <Th align="right">Failed</Th>
                  <Th align="right">Cost, 30d</Th>
                  <Th align="right">Avg latency</Th>
                </Thead>
                <tbody>
                  {gated.data.map((row, i) => (
                    <Tr key={`${row.engine}-${row.modelId ?? 'null'}-${i}`}>
                      <Td className="font-semibold">{row.engine}</Td>
                      <Td className="tabular">{row.modelId ?? '—'}</Td>
                      <Td align="right" className="tabular">
                        {row.runs.toLocaleString('en-AU')}
                      </Td>
                      <Td align="right" className="tabular">
                        {row.succeeded.toLocaleString('en-AU')}
                      </Td>
                      <Td align="right">
                        <span className={row.failed > 0 ? 'tabular font-semibold text-[var(--color-risk)]' : 'tabular'}>
                          {row.failed.toLocaleString('en-AU')}
                        </span>
                      </Td>
                      <Td align="right">
                        <Money amount={row.costAud} />
                      </Td>
                      <Td align="right" className="tabular">
                        {row.avgLatencyMs === null ? '—' : `${Math.round(row.avgLatencyMs)}ms`}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </Card>
      )}

      <NotWired title="Spend overview, weekly trend, and revenue-share guardrail">
        There is no endpoint for platform-wide spend totals, a time series, or a comparison against seat
        revenue — <code>GET /v1/admin/ai/usage</code> above is the only AI-cost read that exists, and it
        is not a time series.
      </NotWired>

      <NotWired title="Spend by tenant">
        No endpoint attributes AI inference cost to a tenant. The <Badge tone="neutral">engine/model</Badge>{' '}
        breakdown above is the finest grain the server currently reports.
      </NotWired>

      <NotWired title="Budget caps and alert thresholds">
        No budget-cap concept exists server-side — nothing to read, nothing to set.
      </NotWired>
    </div>
  );
}
