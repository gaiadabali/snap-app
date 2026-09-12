import { Empty, SectionTitle } from '@/design/primitives';
import { listMembers } from '@/lib/panels/data';
import { inviteMember, removeMember, revokeInvitation, updateMemberRole } from '@/lib/panels/people-actions';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { PeopleClient } from './PeopleClient';

export const metadata = { title: 'People & roles' };

export default async function PeoplePage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/people';
  const [data, permissions] = await Promise.all([listMembers(workspace.id), getPermissions(workspace.id)]);

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="People & roles" lede="Anyone may capture a receipt. Posting to the ledger is an owner or manager action, whatever role someone holds elsewhere." />
      <PeopleClient
        data={data}
        canInvite={permissions.canInvite}
        onInvite={inviteMember.bind(null, workspace.id, path)}
        onRevoke={revokeInvitation.bind(null, workspace.id, path)}
        onSetRole={updateMemberRole.bind(null, workspace.id, path)}
        onRemove={removeMember.bind(null, workspace.id, path)}
      />
    </div>
  );
}
