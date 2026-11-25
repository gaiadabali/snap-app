'use client';

import { useState, useTransition } from 'react';
import type { CategorySetting, DocumentView } from '@snap/api-contract';
import { pickerGroups, taxCategoryHint, workExpenseStatus } from '@snap/api-contract/work-expense';

import { Button, Card, Field, Select } from '@/design/primitives';
import { setDocumentCategory } from '@/lib/panels/document-actions';
import type { ActionResult } from '@/lib/panels/actions';

const NONE = '';

/**
 * Is this receipt a work expense? The web twin of the phone's WorkExpenseCard.
 *
 * A receipt goes to Free Tax Returns when a person files it in a category of their personal
 * space that carries an ATO label (the "Work …" categories, Donations, Tax help, Income
 * protection, or their own given a label). Separate from "Save corrections": filing is not a
 * correction of what was read, so it stays open after the receipt is confirmed.
 */
export function WorkExpenseCard({
  document,
  categories,
  canEdit,
  workspaceId,
  path,
}: {
  document: DocumentView;
  categories: CategorySetting[];
  canEdit: boolean;
  workspaceId: string;
  path: string;
}) {
  const [selected, setSelected] = useState(document.categoryId ?? NONE);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const groups = pickerGroups(categories, document.categoryId);
  const status = workExpenseStatus(document);
  const current = categories.find((c) => c.id === document.categoryId);
  const hint = current ? taxCategoryHint(current) : null;
  const picked = categories.find((c) => c.id === selected);
  const pickedHint = picked ? taxCategoryHint(picked) : null;
  const unchanged = selected === (document.categoryId ?? NONE);

  const save = (categoryId: string | null) =>
    start(async () => setResult(await setDocumentCategory(workspaceId, document.id, path, categoryId)));

  return (
    <Card>
      <h2 className="text-[14px] font-semibold text-[var(--color-ink)]">Tax return</h2>
      <p className="mt-1 text-[14px] text-[var(--color-ink)]">
        <span className="font-semibold">{document.categoryId ? document.category : 'No category'}</span>
        {hint ? <span className="text-[var(--color-ink-muted)]"> · {hint}</span> : null}
      </p>
      <p className={`mt-1 text-[13px] ${status.kind === 'counted' ? 'text-[var(--color-good)]' : 'text-[var(--color-ink-muted)]'}`}>
        {status.text}
      </p>

      {canEdit ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save(selected === NONE ? null : selected);
          }}
        >
          <Field label="Category" hint={pickedHint ?? 'Everyday spending stays out of your tax return.'}>
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={pending}>
              {groups.tax.length > 0 ? (
                <optgroup label="Work and other tax deductions">
                  {groups.tax.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Everyday spending">
                {groups.everyday.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NONE}>No category</option>
              </optgroup>
            </Select>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {status.kind === 'to_confirm' && unchanged ? (
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Confirm category'}
              </Button>
            ) : (
              <Button type="submit" variant="secondary" disabled={pending || unchanged}>
                {pending ? 'Saving…' : 'Save category'}
              </Button>
            )}
            {result && !result.ok ? <span className="text-[13px] text-[var(--color-risk)]">{result.message}</span> : null}
            {result?.ok && !pending ? <span className="text-[13px] text-[var(--color-good)]">Saved.</span> : null}
          </div>
        </form>
      ) : (
        <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Your role here is read-only.</p>
      )}
    </Card>
  );
}
