import { Empty } from '@/design/primitives';
import { getPlanUsage } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';
import { PlanSummary } from '../../_shell/PlanSummary';

export const metadata = { title: 'Plan & usage · Business' };

export default async function BusinessPlanPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;
  const plan = await getPlanUsage(workspace.id);
  return <PlanSummary workspaceName={workspace.name} plan={plan} />;
}
