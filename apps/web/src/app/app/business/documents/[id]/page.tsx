import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Empty } from '@/design/primitives';
import { config } from '@/lib/config';
import { getDocument } from '@/lib/panels/data';
import { getPermissions } from '@/lib/panels/permissions';
import { loadWorkspace } from '@/lib/panels/workspace';
import { ReviewDocument } from '../../../_shell/ReviewDocument';

export const metadata = { title: 'Review document · Business' };

export default async function BusinessDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await loadWorkspace('business');
  if (!workspace) return <Empty title="No business workspace yet" />;

  const [document, permissions] = await Promise.all([
    getDocument(workspace.id, id).catch(() => null),
    getPermissions(workspace.id),
  ]);
  if (!document) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/app/business/documents" className="text-[13px] font-medium text-[var(--color-accent)] hover:underline">
        ← All documents
      </Link>
      <ReviewDocument
        document={document}
        imageBaseUrl={config.apiUrl}
        permissions={permissions}
        workspaceId={workspace.id}
        path={`/app/business/documents/${id}`}
        listPath="/app/business/documents"
        isBusiness
      />
    </div>
  );
}
