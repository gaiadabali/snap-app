'use client';

import { useState, useTransition } from 'react';
import type { Connection } from '@snap/api-contract';

import { Badge, Button, Card, SectionTitle } from '@/design/primitives';
import { formatDateTime } from '@/lib/panels/format';

export function ConnectionsClient({
  connections,
  canManage,
  onConnect,
  onDisconnect,
}: {
  connections: Connection[];
  canManage: boolean;
  onConnect: (id: Connection['id']) => Promise<{ ok: boolean; message?: string; authorizeUrl?: string }>;
  onDisconnect: (id: Connection['id']) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Connections"
        lede="Linking accounting software pushes each confirmed document across, with its original image attached where the provider supports it. Nothing is pushed until you connect."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connections.map((c) => (
          <Card key={c.id}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--color-ink)]">{c.name}</h3>
              <Badge tone={c.status === 'connected' ? 'good' : c.status === 'error' ? 'risk' : 'neutral'}>{c.status}</Badge>
            </div>
            <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">{c.note}</p>
            {c.status === 'connected' ? (
              <div className="mt-3 text-[13px] text-[var(--color-ink-muted)]">
                {c.organisation ? <div>Linked to {c.organisation}</div> : null}
                {c.lastSyncAt ? <div>Last synced {formatDateTime(c.lastSyncAt)}</div> : null}
                {c.queued > 0 ? <div>{c.queued} waiting to send</div> : null}
              </div>
            ) : null}
            {notes[c.id] ? <p className="mt-2 text-[13px] text-[var(--color-risk)]">{notes[c.id]}</p> : null}
            <div className="mt-3">
              {c.status === 'connected' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canManage || busy === c.id}
                  onClick={() => {
                    setBusy(c.id);
                    startTransition(async () => {
                      const result = await onDisconnect(c.id);
                      setNotes((n) => ({ ...n, [c.id]: result.ok ? '' : (result.message ?? '') }));
                      setBusy(null);
                    });
                  }}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!canManage || busy === c.id}
                  onClick={() => {
                    setBusy(c.id);
                    startTransition(async () => {
                      const result = await onConnect(c.id);
                      if (result.ok && result.authorizeUrl) {
                        window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer');
                        setNotes((n) => ({ ...n, [c.id]: '' }));
                      } else {
                        setNotes((n) => ({ ...n, [c.id]: result.message ?? 'Could not start that connection.' }));
                      }
                      setBusy(null);
                    });
                  }}
                >
                  Connect
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
      {!canManage ? <p className="text-[13px] text-[var(--color-ink-muted)]">Only an owner or manager can change connections.</p> : null}
    </div>
  );
}
