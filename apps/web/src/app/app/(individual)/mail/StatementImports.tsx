'use client';

import { useCallback, useEffect, useState } from 'react';

import { Badge, Button } from '@/design/primitives';
import { MailApiFailure, mailApi } from '@/lib/panels/mail-api';
import { dayDate } from '@/lib/panels/mail-format';
import { importLine } from '@/lib/panels/mail-imports';
import type { MailStatementImport } from '@/lib/panels/mail-types';
import { ErrorBlock, ListSkeleton } from './MailUi';

/**
 * "Imported from Spambank": the statements that arrived in this mailbox and what
 * became of each (`GET /v1/mail/imports`, Spambank T12). Read-only; undo is Stage 2.
 */
export function StatementImports() {
  const [items, setItems] = useState<MailStatementImport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      setItems(await mailApi.imports());
    } catch (e) {
      setLoadError(e instanceof MailApiFailure ? e.message : 'Could not load your imported statements.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mt-6" data-testid="statement-imports">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">Imported from Spambank</h3>
        {items !== null ? (
          <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null}
      </div>
      <div className="mt-3">
        {loadError ? (
          <ErrorBlock message={loadError} onRetry={() => void load()} />
        ) : items === null ? (
          <ListSkeleton rows={2} />
        ) : items.length === 0 ? (
          <p className="text-[14px] text-[var(--color-ink-muted)]">
            No statements yet. Forward a statement email to your address and it shows up here.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]">
            {items.map((item) => {
              const line = importLine(item);
              const when = dayDate(item.receivedAt ?? item.createdAt);
              return (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--color-ink)]">
                      {item.fileName ?? 'Statement'}
                    </span>
                    <Badge tone={line.tone}>{line.label}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {line.sentence}
                    {when ? ` Received ${when}` : ''}
                    {item.workspace ? `, into ${item.workspace.name}.` : when ? '.' : ''}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
