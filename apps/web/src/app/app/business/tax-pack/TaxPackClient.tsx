'use client';

import { useState, useTransition } from 'react';
import type { TaxPack, TaxPackFile } from '@snap/api-contract';

import { Badge, Button, Card, Table, Td, Th, Thead, Tr } from '@/design/primitives';

function bytesToMb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function TaxPackClient({
  pack,
  onPrepare,
}: {
  pack: TaxPack;
  onPrepare: () => Promise<{ ok: true; file: TaxPackFile } | { ok: false; message: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: true; file: TaxPackFile } | { ok: false; message: string } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">{pack.periodLabel}</h3>
            <p className="text-[13px] text-[var(--color-ink-muted)]">
              {pack.fromDate} to {pack.toDate} · {bytesToMb(pack.totalBytes)} of original images and worksheets
            </p>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setResult(await onPrepare());
              })
            }
          >
            {pending ? 'Assembling…' : 'Assemble tax pack'}
          </Button>
        </div>
        {result ? (
          result.ok ? (
            <p className="mt-3 text-[13px] text-[var(--color-good)]">
              Ready: {result.file.filename} ({bytesToMb(result.file.bytes)}, {result.file.documentCount} documents).{' '}
              <a href={result.file.url} className="font-semibold underline">
                Download
              </a>{' '}
              — link expires {new Date(result.file.expiresAt).toLocaleTimeString()}.
            </p>
          ) : (
            <p className="mt-3 text-[13px] text-[var(--color-risk)]">{result.message}</p>
          )
        ) : null}
      </Card>

      <Card>
        <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">What it contains</h3>
        <Table>
          <Thead>
            <Th>Section</Th>
            <Th>Detail</Th>
            <Th align="right">Count</Th>
            <Th align="right">Size</Th>
            <Th>Included</Th>
          </Thead>
          <tbody>
            {pack.sections.map((s) => (
              <Tr key={s.label}>
                <Td className="font-medium">{s.label}</Td>
                <Td className="text-[var(--color-ink-muted)]">{s.detail}</Td>
                <Td align="right">{s.count}</Td>
                <Td align="right">{bytesToMb(s.bytes)}</Td>
                <Td>
                  <Badge tone={s.included ? 'good' : 'neutral'}>{s.included ? 'Yes' : 'Nothing yet'}</Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <p className="text-[12px] text-[var(--color-ink-faint)]">{pack.retentionNote}</p>
    </div>
  );
}
