import { Badge, Card } from '@/design/primitives';
import type { ComputedChain as ComputedChainType } from '../../../../_data/governance';

const LABEL = { vision: 'Vision (extraction)', chat: 'Chat (assistant)' } as const;

/**
 * Read-only view of what `router.ts`'s `chain()` computes today, from the
 * same static registry data as `RegistryTable` — not a fabricated ordering,
 * the identical deterministic sort (tier, then median seconds, excluded
 * models filtered out first) the server itself runs.
 *
 * There is no edit control here. The old fixture let an operator drag models
 * up and down an escalation ladder and flip a "primary" select — none of
 * that has anywhere to persist to (`EXTRACTION_MODEL` is a server env var,
 * not an admin-configurable row), so re-adding those controls would be a
 * button that changes nothing on submit.
 */
export function ComputedChain({ chain }: { chain: ComputedChainType }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold">{LABEL[chain.capability]}</h3>
        <Badge tone="neutral">read-only</Badge>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Primary
        </div>
        {chain.primary ? (
          <>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[15px] font-semibold">{chain.primary.id}</span>
              {chain.primary.medianSeconds ? (
                <span className="tabular text-[13px] text-[var(--color-ink-muted)]">
                  {chain.primary.medianSeconds}s median
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{chain.primary.note}</p>
          </>
        ) : (
          <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-risk)]">
            No eligible model — every candidate is excluded.
          </p>
        )}
      </div>

      <div className="mt-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
          Escalation ladder
        </div>
        {chain.escalation.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Nothing beyond the primary.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1.5">
            {chain.escalation.map((m, i) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] px-3 py-2"
              >
                <span className="tabular text-[12px] font-semibold text-[var(--color-ink-faint)]">{i + 2}</span>
                <span className="font-semibold">{m.id}</span>
                <Badge tone="neutral">tier {m.tier}</Badge>
              </li>
            ))}
          </ol>
        )}
      </div>

      {chain.excluded.length > 0 ? (
        <div className="mt-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
            Excluded from this capability
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {chain.excluded.map(({ model, reason }) => (
              <li key={model.id} className="rounded-[var(--radius-md)] bg-[var(--color-risk-soft)] p-2.5 text-[13px]">
                <div className="font-bold text-[var(--color-risk)]">{model.id}</div>
                <div className="mt-0.5 text-[var(--color-ink-muted)]">{reason}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
