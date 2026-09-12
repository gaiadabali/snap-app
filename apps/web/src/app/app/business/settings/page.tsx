import { Empty } from '@/design/primitives';
import { getBusinessSettings, listOccupations } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { updateSettings } from '@/lib/panels/settings-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { SettingsForm } from '../../_shell/SettingsForm';

export const metadata = { title: 'Settings · Business' };

export default async function BusinessSettingsPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/settings';
  const [settings, occupations, permissions] = await Promise.all([
    getBusinessSettings(workspace.id),
    listOccupations(workspace.id),
    getPermissions(workspace.id),
  ]);

  return (
    <SettingsForm
      settings={settings}
      occupations={occupations}
      canEdit={permissions.canManageBudgets}
      isBusiness
      onSave={updateSettings.bind(null, workspace.id, path, true)}
    />
  );
}
