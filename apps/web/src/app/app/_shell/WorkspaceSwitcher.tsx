'use client';

import { usePathname } from 'next/navigation';
import { useRef, useTransition } from 'react';

import { cx } from '@/design/primitives';
import { switchWorkspace } from '@/lib/panels/actions';

/**
 * A dropdown that changes which workspace of THIS kind is active.
 *
 * Only rendered when there is more than one to choose from — a person who
 * owns one business never sees a picker with one option in it, which is not
 * a choice. Submits on change rather than needing a separate "Go" button:
 * switching books is common enough during a review session that a second
 * click would be friction with no benefit. Revalidates the page the picker
 * was used FROM, read client-side (a layout has no reliable way to know the
 * leaf path of the page inside it).
 */
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: Array<{ id: string; name: string }>;
  activeId: string;
}) {
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) => {
        const id = String(formData.get('workspaceId'));
        startTransition(async () => {
          await switchWorkspace(path, id);
        });
      }}
    >
      <select
        name="workspaceId"
        defaultValue={activeId}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
        className={cx(
          'h-9 max-w-[220px] truncate rounded-[var(--radius-md)] border border-[var(--color-rule-strong)]',
          'bg-[var(--color-surface)] px-2.5 text-[13px] font-medium text-[var(--color-ink)]',
          pending && 'opacity-60',
        )}
        aria-label="Switch workspace"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </form>
  );
}
