import { Card } from '@/design/primitives';

import { getModelRegistry, getRouting } from '../../../_data/governance';

import { RegistryTable } from './_components/RegistryTable';
import { RoutingControls } from './_components/RoutingControls';

export const metadata = { title: 'Models & routing · Snap Apps admin' };

export default async function ModelsPage() {
  const [models, routing] = await Promise.all([getModelRegistry(), getRouting()]);

  const visionModels = models.filter((m) => m.enabled && m.capabilities.includes('vision'));
  const chatModels = models.filter((m) => m.enabled && m.capabilities.includes('chat'));

  return (
    <div className="flex flex-col gap-6">
      <Card tone="ground">
        <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
          This registry mirrors <code className="tabular">apps/server/src/ai/router.ts</code> — the
          real capability chain, with measured benchmark scores and median latencies from{' '}
          <code>docs/AI.md</code>. Note: <code>apps/server/src/config.ts</code>&apos;s{' '}
          <code>EXTRACTION_MODEL</code> currently defaults to <strong>gemma4:31b</strong>, not{' '}
          <strong>minimax-m3</strong> — the deployed pin and the routing table below disagree until
          this console is wired to a real endpoint. Changing &quot;primary&quot; here is what would
          resolve that once it is.
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <RoutingControls capability="vision" routing={routing.vision} models={visionModels} />
        <RoutingControls capability="chat" routing={routing.chat} models={chatModels} />
      </div>

      <Card>
        <h3 className="text-[16px] font-bold">Full registry</h3>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Disabling a model removes it from every escalation ladder and refuses to let it stay
          primary. A registry of untested models is a registry of guesses — every score here is
          re-run whenever a model is added (<code>docs/AI.md</code> §4).
        </p>
        <div className="mt-4">
          <RegistryTable models={models} />
        </div>
      </Card>
    </div>
  );
}
