import { Card } from '@/design/primitives';

import { computeChain, getModelRegistry } from '../../../_data/governance';

import { ComputedChain } from './_components/ComputedChain';
import { RegistryTable } from './_components/RegistryTable';

export const metadata = { title: 'Models & routing · Snap Apps admin' };

export default function ModelsPage() {
  const models = getModelRegistry();
  const vision = computeChain('vision');
  const chat = computeChain('chat');

  return (
    <div className="flex flex-col gap-6">
      <Card tone="ground">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          This registry is a STATIC mirror of <code className="tabular">apps/server/src/ai/router.ts</code>
          , not a live read — there is no admin endpoint that returns it, and no endpoint to change
          routing either, so the panels below are read-only. Note:{' '}
          <code>apps/server/src/config.ts</code>&apos;s <code>EXTRACTION_MODEL</code> currently defaults to{' '}
          <strong>gemma4:31b</strong>, not <strong>minimax-m3</strong> — the deployed pin and the computed
          primary below disagree, and there is currently no admin surface that would let anyone resolve
          that from here.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <ComputedChain chain={vision} />
        <ComputedChain chain={chat} />
      </div>

      <Card>
        <h3 className="text-[16px] font-bold">Full registry</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Every score here is re-run whenever a model is added (<code>docs/AI.md</code> §4). An excluded
          model still appears — it genuinely has the capability, and the project has decided not to use
          it there anyway; the reason is kept, not hidden.
        </p>
        <div className="mt-4">
          <RegistryTable models={models} />
        </div>
      </Card>
    </div>
  );
}
