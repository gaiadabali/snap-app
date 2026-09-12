'use client';

import { Badge, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import type { ModelRegistryEntry } from '../../../../_data/governance';

import { ToggleControl } from '../../../_components/ToggleControl';
import { setModelEnabledAction } from '../actions';

export function RegistryTable({ models }: { models: ModelRegistryEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <Thead>
          <Th>Model</Th>
          <Th>Capability</Th>
          <Th align="right">Tier</Th>
          <Th align="right">Benchmark</Th>
          <Th align="right">Median latency</Th>
          <Th>Note</Th>
          <Th align="right">Enabled</Th>
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
              <Td className="max-w-[360px] text-[13px] text-[var(--color-ink-muted)]">
                {m.note}
                {m.caution ? (
                  <div className="mt-1.5 flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] p-2 text-[12px] text-[var(--color-warn)]">
                    <span aria-hidden>⚠</span>
                    <span>{m.caution}</span>
                  </div>
                ) : null}
              </Td>
              <Td align="right">
                <div className="flex justify-end">
                  <ToggleControl
                    key={`${m.id}-${m.enabled}`}
                    checked={m.enabled}
                    label={`${m.id} enabled`}
                    onToggle={(next) => setModelEnabledAction(m.id, next)}
                  />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
