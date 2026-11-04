import type { FamilyStatus } from '@snap/api-contract';

import { Empty, SectionTitle } from '@/design/primitives';
import { getFamily } from '@/lib/panels/data';
import { createTeenInvite, endTeenAccess } from '@/lib/panels/family-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { FamilyClient } from './FamilyClient';

export const metadata = { title: 'Family' };

const PATH = '/app/family';

/** Family: invite your teen (group 3.10). The invite is made from the active workspace, whose credits it spends. */
export default async function FamilyPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  let status: FamilyStatus | null = null;
  try {
    status = await getFamily();
  } catch {
    // Shown as an error below, never as "no teens".
  }
  if (!status) return <Empty title="Family isn’t available right now" body="Try again in a minute." />;

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Family" />
      <FamilyClient
        status={status}
        canInvite={workspace.role === 'owner' && !workspace.teenSpace}
        onCreate={createTeenInvite.bind(null, workspace.id, PATH)}
        onEnd={endTeenAccess.bind(null, PATH)}
      />
    </div>
  );
}
