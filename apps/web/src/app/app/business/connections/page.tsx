import { Empty } from '@/design/primitives';
import { connectAccounting, disconnectAccounting } from '@/lib/panels/connection-actions';
import { listConnections } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { ConnectionsClient } from '../../_shell/ConnectionsClient';

export const metadata = { title: 'Connections · Business' };

export default async function BusinessConnectionsPage() {
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const path = '/app/business/connections';
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
