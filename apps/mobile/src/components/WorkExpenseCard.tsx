import { useState } from 'react';
import { taxCategoryHint, workExpenseStatus } from '@snap/api-contract/work-expense';

import { api, type CategorySetting, type DocumentView } from '@/api';
import { Sheet } from '@/components/form';
import { Small } from '@/components/ui';
import { CategoryOptions, WorkExpenseSummary } from './WorkExpenseParts';

/**
 * Is this receipt a work expense? (group plan: receipts to Free Tax Returns, 2026-11-25)
 *
 * A receipt goes to Free Tax Returns when a person files it in a category of their personal
 * space that carries an ATO label: the "Work …" categories, Donations, Tax help, Income
 * protection, or one of their own given a label. The category is the deduction type, and the
 * whole receipt counts, GST included, less the category's private-use share.
 *
 * This card lives outside "Correct the details" on purpose: filing a receipt is not a
 * correction of what was read, so it stays open after the receipt is confirmed.
 */
export function WorkExpenseCard({
  doc,
  canEdit,
  onChange,
}: {
  doc: DocumentView;
  canEdit: boolean;
  onChange: (next: DocumentView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<CategorySetting[] | null>(null);
  const [selected, setSelected] = useState<string | null>(doc.categoryId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = workExpenseStatus(doc);
  const hint = taxCategoryHint({ taxLabel: doc.taxLabel, engineRowId: doc.engineRowId, privateUsePercent: null });

  async function save(categoryId: string | null) {
    setError(null);
    try {
      const next = await api().updateDocument(doc.id, { edits: { 'header.category_id': categoryId } });
      onChange(next ?? doc);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the category.');
    }
  }

  async function openPicker() {
    setError(null);
    setSelected(doc.categoryId);
    setOpen(true);
    try {
      setCategories(await api().listCategorySettings('personal'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your categories.');
    }
  }

  async function confirm() {
    setBusy(true);
    try {
      await save(doc.categoryId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <WorkExpenseSummary
        category={doc.categoryId ? doc.category : null}
        hint={hint}
        status={status}
        canEdit={canEdit}
        busy={busy}
        error={open ? null : error}
        onChoose={() => void openPicker()}
        onConfirm={() => void confirm()}
      />
      <Sheet
        open={open}
        title="Category"
        subtitle="A work category sends this receipt to Free Tax Returns as a deduction."
        error={error}
        submitLabel="Save category"
        submitDisabled={categories === null || (selected === doc.categoryId && doc.categorySource === 'user')}
        onClose={() => setOpen(false)}
        onSubmit={() => save(selected)}
      >
        {categories === null ? (
          <Small>Loading your categories…</Small>
        ) : (
          <CategoryOptions categories={categories} currentId={doc.categoryId} selected={selected} onSelect={setSelected} />
        )}
      </Sheet>
    </>
  );
}
