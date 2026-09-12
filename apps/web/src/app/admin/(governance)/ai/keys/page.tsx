import { Card, Empty } from '@/design/primitives';

import { getAiProviders } from '../../../_data/governance';

import { KmsWarning } from '../../_components/KmsWarning';
import { RefusalPanel } from '../../_components/RefusalPanel';
import { ToggleControl } from '../../_components/ToggleControl';
import { AddProviderForm } from './_components/AddProviderForm';
import { KeyForm } from './_components/KeyForm';
import { setProviderActiveAction } from './actions';

export const metadata = { title: 'API keys · Snap Apps admin' };

export default async function KeysPage() {
  const gated = await getAiProviders();

  return (
    <div className="flex flex-col gap-6">
      <Card tone="ground">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          Keys are stored encrypted — app-level AEAD, KMS-wrapped DEK, ciphertext in <code>BYTEA</code>.
          This screen only ever shows a prefix and last four characters, never the value, and there is no
          endpoint anywhere that can read one back by design — see <code>docs/WEB.md</code> §6.
        </p>
      </Card>

      <KmsWarning />

      {!gated.allowed ? (
        <RefusalPanel capability="manage_ai_config" status={gated.status} message={gated.message} />
      ) : (
        <>
          <AddProviderForm />

          {gated.data.length === 0 ? (
            <Empty
              title="No AI provider configurations yet"
              body="Add one above, then set its key below."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {gated.data.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-bold">{p.label}</h3>
                      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                        {p.provider}
                        {p.defaultModel ? ` · default model ${p.defaultModel}` : ''}
                      </p>
                    </div>
                    <ToggleControl
                      key={`${p.id}-${p.isActive}`}
                      checked={p.isActive}
                      label={`${p.label} active`}
                      onToggle={(next) =>
                        setProviderActiveAction({
                          provider: p.provider,
                          label: p.label,
                          defaultModel: p.defaultModel,
                          isActive: next,
                        })
                      }
                    />
                  </div>

                  <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
                      Current key
                    </div>
                    {p.hasLiveKey ? (
                      <div className="tabular mt-1 text-[15px] font-semibold">
                        {p.keyPrefix}
                        <span className="text-[var(--color-ink-faint)]">••••••••</span>
                        {p.keyLast4}
                      </div>
                    ) : (
                      <div className="mt-1 text-[14px] font-semibold text-[var(--color-risk)]">Not set</div>
                    )}
                  </div>

                  <div className="mt-4">
                    <KeyForm configId={p.id} hasLiveKey={p.hasLiveKey} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
