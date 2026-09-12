'use client';

import { useState, useTransition } from 'react';

import { Badge, Button, Field } from '@/design/primitives';
import type { ClientTarget, MaintenanceMode } from '../../../_data/governance';

import { ConfirmDialog } from '../../_components/ConfirmDialog';
import { setMaintenanceModeAction } from '../actions';

const ALL_CLIENTS: ClientTarget[] = ['mobile', 'website', 'server'];

export function MaintenancePanel({ mode }: { mode: MaintenanceMode }) {
  const [message, setMessage] = useState(mode.message);
  const [clients, setClients] = useState<ClientTarget[]>(mode.clients);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleClient(c: ClientTarget) {
    setClients((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function disableNow() {
    setError(null);
    startTransition(async () => {
      try {
        await setMaintenanceModeAction({ enabled: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not disable maintenance mode.');
      }
    });
  }

  function saveMessage() {
    setError(null);
    startTransition(async () => {
      try {
        await setMaintenanceModeAction({ message, clients });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">Maintenance mode</span>
            <Badge tone={mode.enabled ? 'risk' : 'good'}>{mode.enabled ? 'ON — service is degraded' : 'off'}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Pauses capture and shows the message below on the affected clients. Nothing already
            captured is lost.
          </p>
        </div>

        {mode.enabled ? (
          <Button variant="primary" size="sm" onClick={disableNow} disabled={pending}>
            {pending ? 'Disabling…' : 'Disable now'}
          </Button>
        ) : (
          <ConfirmDialog
            triggerLabel="Enable maintenance mode"
            title="Enable maintenance mode"
            confirmPhrase="MAINTENANCE"
            blastRadius={
              <>
                This pauses capture on <strong>{clients.length === 0 ? 'no clients (select at least one below)' : clients.join(', ')}</strong> immediately for every tenant on the platform, and shows the message below in its place. It stays on until explicitly disabled.
              </>
            }
            onConfirm={async () => {
              if (clients.length === 0) throw new Error('Select at least one affected client first.');
              await setMaintenanceModeAction({ enabled: true, message, clients });
            }}
          />
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Message shown to users" htmlFor="maint-message">
          <textarea
            id="maint-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            className="rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] p-2 text-[14px] text-[var(--color-ink)]"
          />
        </Field>

        <div>
          <div className="text-[13px] font-semibold text-[var(--color-ink)]">Affects</div>
          <div className="mt-1.5 flex gap-2">
            {ALL_CLIENTS.map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={clients.includes(c)} onChange={() => toggleClient(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>

        <div>
          <Button size="sm" variant="secondary" onClick={saveMessage} disabled={pending}>
            {pending ? 'Saving…' : 'Save message & clients'}
          </Button>
        </div>
      </div>

      {error ? <p className="mt-2 text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
    </div>
  );
}
