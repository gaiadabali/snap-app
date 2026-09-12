import { Badge, Card } from '@/design/primitives';

import { getApiKeyProviders, getAuditLog } from '../../../_data/governance';

import { KeyForm } from './_components/KeyForm';

export const metadata = { title: 'API keys · Snap Apps admin' };

export default async function KeysPage() {
  const [providers, audit] = await Promise.all([getApiKeyProviders(), getAuditLog(50)]);
  const keyEvents = audit.filter((e) => e.action.startsWith('ai_key.'));

  return (
    <div className="flex flex-col gap-6">
      <Card tone="ground">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          Keys are stored encrypted — app-level AEAD, KMS-wrapped DEK, ciphertext in <code>BYTEA</code>.
          This screen only ever shows a prefix and last four characters, never the value, and never
          reads one back — see <code>docs/WEB.md</code> §6.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((p) => (
          <Card key={p.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[16px] font-bold">{p.label}</h3>
                <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{p.description}</p>
              </div>
              <Badge tone={p.status === 'configured' ? 'good' : p.status === 'missing' ? 'risk' : 'neutral'}>
                {p.status === 'not_applicable' ? 'not a UI secret' : p.status}
              </Badge>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                Current value
              </div>
              {p.editable ? (
                p.status === 'configured' ? (
                  <div className="tabular mt-1 text-[15px] font-semibold">
                    {p.prefix}
                    <span className="text-[var(--color-ink-faint)]">••••••••</span>
                    {p.last4}
                  </div>
                ) : (
                  <div className="mt-1 text-[14px] font-semibold text-[var(--color-risk)]">Not set</div>
                )
              ) : (
                <div className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
                  No static value — ambient credential chain.
                </div>
              )}
              {p.setAt ? (
                <div className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
                  Set {new Date(p.setAt).toLocaleDateString('en-AU')} by {p.setBy} · rotated {p.rotatedCount}×
                </div>
              ) : null}
              {p.envVar ? (
                <div className="mt-1 text-[12px] text-[var(--color-ink-faint)]">
                  Maps to <code>{p.envVar}</code> in <code>apps/server/src/config.ts</code>
                </div>
              ) : null}
            </div>

            <p className="mt-3 text-[13px] text-[var(--color-ink-muted)]">{p.usedFor}</p>

            <div className="mt-4">
              {p.editable ? (
                <KeyForm providerId={p.id} wasConfigured={p.status === 'configured'} />
              ) : (
                <p className="text-[13px] text-[var(--color-ink-faint)]">
                  This provider deliberately has no settable key here — see the note above.
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h3 className="text-[16px] font-bold">Key audit trail</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Every set or rotate, who did it, when — never the value.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {keyEvents.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule)] pb-2 text-[13px] last:border-0">
              <span>{e.detail}</span>
              <span className="tabular shrink-0 text-[var(--color-ink-faint)]">
                {new Date(e.at).toLocaleString('en-AU')} · {e.actor}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
