import { Badge, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import type { Capability, ModelRegistryEntry } from '../../../../_data/governance';

/**
 * The full static registry, exclusions surfaced explicitly.
 *
 * An excluded model is NOT "disabled" — it genuinely has the capability and
 * the project has decided not to use it there anyway, for a documented
 * reason (`router.ts`'s `chain()` enforces this, refusing it even if pinned
 * explicitly). So this never collapses to a single "enabled/disabled" toggle;
 * each excluded capability gets its own badge and its own reason, and a
 * general-purpose model that is merely absent from a capability (e.g. a
 * vision-only model has no chat entry at all) is not shown as excluded from
 * it — there is nothing to explain there.
 */
export function RegistryTable({ models }: { models: ModelRegistryEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <Thead>
          <Th>Model</Th>
          <Th>Capabilities</Th>
          <Th align="right">Tier</Th>
          <Th align="right">Benchmark</Th>
          <Th align="right">Median latency</Th>
          <Th>Note</Th>
          <Th>Excluded</Th>
        </Thead>
        <tbody>
          {models.map((m) => (
            <Tr key={m.id}>
              <Td className="font-semibold">{m.id}</Td>
              <Td>
                <div className="flex gap-1">
                  {m.capabilities.map((c) => (
                    <Badge key={c} tone="accent">
                      {c}
                    </Badge>
                  ))}
                </div>
              </Td>
              <Td align="right" className="tabular">
                {m.tier}
              </Td>
              <Td align="right" className="tabular">
                {m.benchmarkScore === null ? '—' : `${m.benchmarkScore}/8`}
              </Td>
              <Td align="right" className="tabular">
                {m.medianSeconds === null ? '—' : `${m.medianSeconds.toFixed(2)}s`}
              </Td>
              <Td className="max-w-[320px] text-[13px] text-[var(--color-ink-muted)]">{m.note}</Td>
              <Td className="max-w-[320px]">
                {m.excludedFrom && Object.keys(m.excludedFrom).length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {(Object.entries(m.excludedFrom) as Array<[Capability, string]>).map(
                      ([cap, reason]) => (
                        <div
                          key={cap}
                          className="rounded-[var(--radius-sm)] bg-[var(--color-risk-soft)] p-2 text-[12px] text-[var(--color-risk)]"
                        >
                          <div className="font-bold uppercase tracking-[0.04em]">Excluded from {cap}</div>
                          <div className="mt-0.5 text-[var(--color-ink-muted)]">{reason}</div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <span className="text-[12px] text-[var(--color-ink-faint)]">None</span>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
