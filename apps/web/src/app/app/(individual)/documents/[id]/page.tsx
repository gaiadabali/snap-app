import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Empty } from '@/design/primitives';
import { config } from '@/lib/config';
import { getDocument } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { ReviewDocument } from '../../../_shell/ReviewDocument';

export const metadata = { title: 'Review document' };

export default async function IndividualDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const [document, permissions] = await Promise.all([
    getDocument(workspace.id, id).catch(() => null),
    getPermissions(workspace.id),
  ]);
  if (!document) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/documents" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
        ← All documents
      </Link>
      <ReviewDocument
        document={document}
        imageBaseUrl={config.apiUrl}
        permissions={permissions}
        workspaceId={workspace.id}
        path={`/app/documents/${id}`}
        listPath="/app/documents"
        isBusiness={false}
      />
    </div>
  );
}
