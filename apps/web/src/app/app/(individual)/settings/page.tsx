import { Empty } from '@/design/primitives';
import { getBusinessSettings, getInstalledTaxRules, listOccupations } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { updateSettings } from '@/lib/panels/settings-actions';
import { installTaxRules } from '@/lib/panels/taxrules-actions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { SettingsForm } from '../../_shell/SettingsForm';
import { TaxRulesCard } from '../../_shell/TaxRulesCard';

export const metadata = { title: 'Settings' };

export default async function PersonalSettingsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/settings';
  const [settings, occupations, permissions, taxRules] = await Promise.all([
    getBusinessSettings(workspace.id),
    listOccupations(workspace.id),
    getPermissions(workspace.id),
    // Never throws for "no engine installed" — that is a 200 carrying a
    // `problem`, because this screen has to render the state and offer the
    // list to install from.
    getInstalledTaxRules(workspace.id),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <SettingsForm
        settings={settings}
        occupations={occupations}
        canEdit={permissions.canManageBudgets}
        isBusiness={false}
        onSave={updateSettings.bind(null, workspace.id, path, false)}
      />
      <TaxRulesCard
        installed={taxRules}
        canEdit={permissions.canManageBudgets}
        onInstall={installTaxRules.bind(null, workspace.id, path)}
      />
    </div>
  );
}
