import { Empty } from '@/design/primitives';
import { connectAccounting, disconnectAccounting } from '@/lib/panels/connection-actions';
import { listConnections } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { ConnectionsClient } from '../../_shell/ConnectionsClient';

export const metadata = { title: 'Connections' };

export default async function PersonalConnectionsPage() {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const path = '/app/connections';
  const [connections, permissions] = await Promise.all([listConnections(workspace.id), getPermissions(workspace.id)]);

  return (
    <ConnectionsClient
      connections={connections}
      canManage={permissions.canInvite}
      onConnect={connectAccounting.bind(null, workspace.id, path)}
      onDisconnect={disconnectAccounting.bind(null, workspace.id, path)}
    />
  );
}
