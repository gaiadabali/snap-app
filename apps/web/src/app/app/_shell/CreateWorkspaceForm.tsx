'use client';

import { useActionState } from 'react';

import { Button, Field, Input } from '@/design/primitives';
import { createWorkspace, type ActionResult } from '@/lib/panels/actions';

export function CreateWorkspaceForm({
  kind,
  path,
  placeholder,
}: {
  kind: 'business' | 'personal';
  path: string;
  placeholder: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createWorkspace.bind(null, kind, path),
    null,
  );
  return (
    <form action={formAction} className="mx-auto flex max-w-[360px] flex-col gap-3 text-left">
      <Field label={kind === 'business' ? 'Business name' : 'Household name'} error={state && !state.ok ? state.message : undefined}>
        <Input name="name" placeholder={placeholder} required disabled={pending} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : `Create ${kind === 'business' ? 'business' : 'household'} workspace`}
      </Button>
    </form>
  );
}
