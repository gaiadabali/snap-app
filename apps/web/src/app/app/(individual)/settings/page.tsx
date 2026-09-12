import { Empty } from '@/design/primitives';
import { getBusinessSettings, listOccupations } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { updateSettings } from '@/lib/panels/settings-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { SettingsForm } from '../../_shell/SettingsForm';

export const metadata = { title: 'Settings' };

export default async function PersonalSettingsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/settings';
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
      isBusiness={false}
      onSave={updateSettings.bind(null, workspace.id, path, false)}
    />
  );
}
