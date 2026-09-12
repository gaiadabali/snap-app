import { Empty, SectionTitle } from '@/design/primitives';
import { getTaxPack } from '@/lib/panels/data';
import { prepareTaxPack } from '@/lib/panels/taxpack-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { TaxPackClient } from './TaxPackClient';

export const metadata = { title: 'Tax pack' };

export default async function TaxPackPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const pack = await getTaxPack(workspace.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle
        as="h1"
        title="Tax pack"
        lede="A ZIP of every original image this financial year, a BAS worksheet and a CSV summary — what an accountant actually asks for at year end."
      />
      <TaxPackClient pack={pack} onPrepare={prepareTaxPack.bind(null, workspace.id)} />
    </div>
  );
}
