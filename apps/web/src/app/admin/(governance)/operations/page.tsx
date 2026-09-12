import { Badge, Card, SectionTitle, Table, Td, Th, Thead, Tr } from '@/design/primitives';

import {
  getJobFailures,
  getModelRegistry,
  getQueueStats,
  getRateLimits,
  getRetentionJobs,
  getStorageUsage,
  getTenantOptions,
  getWorkerHealth,
} from '../../_data/governance';

import { PurgePanel } from './_components/PurgePanel';
import { ReplayPanel } from './_components/ReplayPanel';
import { RetryButton } from './_components/RetryButton';
import { bytesToHuman, relativeTime, secondsToHuman } from '../_components/format';

export const metadata = { title: 'Operations · Snap Apps admin' };

const WORKER_TONE = { healthy: 'good', degraded: 'warn', down: 'risk' } as const;

export default async function OperationsPage() {
  const [queues, workers, failures, retention, storage, rateLimits, models, tenants] = await Promise.all([
    getQueueStats(),
    getWorkerHealth(),
    getJobFailures(),
    getRetentionJobs(),
    getStorageUsage(),
    getRateLimits(),
    getModelRegistry(),
    getTenantOptions(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        eyebrow="Governance · Operations"
        title="What the running system is doing"
        lede="Queue depth and throughput, worker health, job failures, replayable extraction, retention, and storage."
      />

      <Card>
        <h3 className="text-[16px] font-bold">Queues</h3>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Queue</Th>
              <Th align="right">Depth</Th>
              <Th align="right">Throughput</Th>
              <Th align="right">Oldest job</Th>
            </Thead>
            <tbody>
              {queues.map((q) => (
                <Tr key={q.queue}>
                  <Td className="font-semibold">{q.label}</Td>
                  <Td align="right" className="tabular">
                    {q.depth.toLocaleString('en-AU')}
                  </Td>
                  <Td align="right" className="tabular">
                    {q.throughputPerMin.toFixed(1)}/min
                  </Td>
                  <Td align="right" className={q.oldestJobAgeSeconds > 86_400 ? 'font-semibold text-[var(--color-risk)]' : undefined}>
                    {secondsToHuman(q.oldestJobAgeSeconds)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Worker health</h3>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Worker</Th>
              <Th>Role</Th>
              <Th align="right">Status</Th>
              <Th align="right">Last heartbeat</Th>
              <Th align="right">Jobs in flight</Th>
              <Th>Version</Th>
            </Thead>
            <tbody>
              {workers.map((w) => (
                <Tr key={w.workerId}>
                  <Td className="font-semibold">{w.workerId}</Td>
                  <Td>{w.role}</Td>
                  <Td align="right">
                    <Badge tone={WORKER_TONE[w.status]}>{w.status}</Badge>
                  </Td>
                  <Td align="right" className="tabular">
                    {w.lastHeartbeatSecondsAgo}s ago
                  </Td>
                  <Td align="right" className="tabular">
                    {w.jobsInFlight}
                  </Td>
                  <Td className="tabular text-[var(--color-ink-muted)]">{w.version}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card>
        <h3 className="text-[16px] font-bold">Job failures &amp; retries, last 24h</h3>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Job type</Th>
              <Th align="right">Failed</Th>
              <Th align="right">Retried</Th>
              <Th align="right">Succeeded after retry</Th>
              <Th>Top error</Th>
              <Th align="right"> </Th>
            </Thead>
            <tbody>
              {failures.map((f) => (
                <Tr key={f.jobType}>
                  <Td className="font-semibold">{f.label}</Td>
                  <Td align="right" className={f.failed24h > 0 ? 'tabular font-semibold text-[var(--color-risk)]' : 'tabular'}>
                    {f.failed24h}
                  </Td>
                  <Td align="right" className="tabular">
                    {f.retried24h}
                  </Td>
                  <Td align="right" className="tabular">
                    {f.succeededAfterRetry24h}
                  </Td>
                  <Td className="max-w-[320px] text-[13px] text-[var(--color-ink-muted)]">{f.topError}</Td>
                  <Td align="right">
                    <RetryButton jobType={f.jobType} count={f.failed24h - f.retried24h} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <ReplayPanel tenants={tenants} models={models.filter((m) => m.enabled && m.capabilities.includes('vision'))} />

      <Card>
        <h3 className="text-[16px] font-bold">Retention &amp; purge jobs</h3>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Job</Th>
              <Th>Schedule</Th>
              <Th align="right">Last run</Th>
              <Th align="right">Status</Th>
              <Th align="right">Documents purged</Th>
              <Th align="right">Next run</Th>
            </Thead>
            <tbody>
              {retention.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold">{r.name}</Td>
                  <Td className="text-[13px] text-[var(--color-ink-muted)]">{r.schedule}</Td>
                  <Td align="right" className="tabular">
                    {relativeTime(r.lastRunAt)}
                  </Td>
                  <Td align="right">
                    <Badge tone={r.lastRunStatus === 'success' ? 'good' : r.lastRunStatus === 'failed' ? 'risk' : 'neutral'}>
                      {r.lastRunStatus}
                    </Badge>
                  </Td>
                  <Td align="right" className="tabular">
                    {r.documentsPurged}
                  </Td>
                  <Td align="right" className="tabular">
                    {relativeTime(r.nextRunAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      <PurgePanel />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-[16px] font-bold">Storage</h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <Thead>
                <Th>Bucket</Th>
                <Th align="right">Size</Th>
                <Th align="right">Objects</Th>
              </Thead>
              <tbody>
                {storage.map((s) => (
                  <Tr key={s.bucket}>
                    <Td className="font-semibold">{s.label}</Td>
                    <Td align="right" className="tabular">
                      {bytesToHuman(s.bytes)}
                    </Td>
                    <Td align="right" className="tabular">
                      {s.objectCount.toLocaleString('en-AU')}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card>
          <h3 className="text-[16px] font-bold">Rate limits</h3>
          <div className="mt-4 overflow-x-auto">
            <Table>
              <Thead>
                <Th>Scope</Th>
                <Th>Limit</Th>
                <Th align="right">Usage</Th>
              </Thead>
              <tbody>
                {rateLimits.map((r) => (
                  <Tr key={r.scope}>
                    <Td className="font-semibold">{r.scope}</Td>
                    <Td className="text-[13px] text-[var(--color-ink-muted)]">{r.limit}</Td>
                    <Td align="right">
                      <Badge tone={r.tone === 'ok' ? 'good' : r.tone === 'warn' ? 'warn' : 'risk'}>
                        {r.currentUsagePct}%
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
