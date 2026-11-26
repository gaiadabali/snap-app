import { useState } from 'react';
import { formatAud, splitLinesCents } from '@snap/api-contract/receipt-split';
import { isTaxCategory, taxCategoryHint, workExpenseStatus, workLinesSplit } from '@snap/api-contract/work-expense';

import { api, type CategorySetting, type DocumentView } from '@/api';
import { Sheet } from '@/components/form';
import { Small } from '@/components/ui';
import { CategoryOptions, WorkExpenseSummary, WorkLineOptions, type WorkLineRow } from './WorkExpenseParts';

/**
 * Is this receipt a work expense? (group plan: receipts to Free Tax Returns, 2026-11-25)
 *
 * A receipt goes to Free Tax Returns when a person files it in a category of their personal
 * space that carries an ATO label: the "Work …" categories, Donations, Tax help, Income
 * protection, or one of their own given a label. The category is the deduction type, and the
 * whole receipt counts, GST included, less the category's private-use share.
 *
 * Or only some of it: "Mark work lines" files single lines in a work category of their own
 * (one work item on a supermarket docket, 2026-11-26). Those count what was paid for them, GST
 * included; the rest of the receipt follows the receipt's category (docs/DEDUCTIONS.md).
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
  const [linesOpen, setLinesOpen] = useState(false);
  const [categories, setCategories] = useState<CategorySetting[] | null>(null);
  const [selected, setSelected] = useState<string | null>(doc.categoryId);
  /** Line number to category id (null: back with the receipt), on top of what is saved. */
  const [draft, setDraft] = useState<Record<number, string | null>>({});
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = workExpenseStatus(doc);
  const hint = taxCategoryHint({ taxLabel: doc.taxLabel, engineRowId: doc.engineRowId, privateUsePercent: null });

  const nameOf = (id: string | null) =>
    id ? (categories?.find((c) => c.id === id)?.name ?? doc.lines.find((l) => l.categoryId === id)?.category ?? null) : null;
  const rows = (overrides: Record<number, string | null>): WorkLineRow[] => {
    const split = workLinesSplit(doc, overrides);
    return doc.lines.map((l) => {
      const categoryId = l.lineNumber in overrides ? (overrides[l.lineNumber] ?? null) : (l.categoryId ?? null);
      const paid = split.lines.find((x) => x.lineNumber === l.lineNumber)?.paidCents ?? 0n;
      return { lineNumber: l.lineNumber, description: l.description, paid: formatAud(paid), categoryId, categoryName: nameOf(categoryId) };
    });
  };

  async function loadCategories() {
    try {
      setCategories(await api().listCategorySettings('personal'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your categories.');
    }
  }

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
    await loadCategories();
  }

  async function openLines() {
    setError(null);
    setDraft({});
    setOpenLine(null);
    setLinesOpen(true);
    await loadCategories();
  }

  /** A newly ticked line takes the last work category chosen here, else the receipt's own (if it is one). */
  function defaultCategory(): string | null {
    const picked = Object.values(draft).filter((v): v is string => Boolean(v));
    if (picked.length > 0) return picked[picked.length - 1]!;
    const saved = doc.lines.map((l) => l.categoryId).filter((v): v is string => Boolean(v));
    if (saved.length > 0) return saved[saved.length - 1]!;
    const own = categories?.find((c) => c.id === doc.categoryId);
    return own && isTaxCategory(own) ? own.id : null;
  }

  function toggle(lineNumber: number) {
    const current = rows(draft).find((r) => r.lineNumber === lineNumber)?.categoryId ?? null;
    if (current !== null) {
      setDraft({ ...draft, [lineNumber]: null });
      if (openLine === lineNumber) setOpenLine(null);
    } else {
      // Ticked with no work category to start from: open the list straight away.
      const start = defaultCategory();
      setDraft({ ...draft, [lineNumber]: start ?? '' });
      setOpenLine(lineNumber);
    }
  }

  const draftRows = rows(draft);
  const changes = doc.lines
    .filter((l) => l.lineNumber in draft && (draft[l.lineNumber] || null) !== (l.categoryId ?? null))
    .map((l) => ({ lineNumber: l.lineNumber, categoryId: draft[l.lineNumber] || null }));
  const unpicked = Object.values(draft).some((v) => v === '');
  const total = formatAud(splitLinesCents(workLinesSplit(doc, Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v || null])))));

  async function saveLines() {
    setError(null);
    try {
      const next = await api().setLineCategories(doc.id, { lines: changes, version: doc.version });
      onChange(next ?? doc);
      setLinesOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the work lines.');
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
        error={open || linesOpen ? null : error}
        onChoose={() => void openPicker()}
        onConfirm={() => void confirm()}
        lines={rows({})}
        onMarkLines={() => void openLines()}
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
      <Sheet
        open={linesOpen}
        title="Work lines"
        subtitle="Tick the lines you bought for work and choose a work category for each. Only those lines go to Free Tax Returns."
        error={error ?? (unpicked ? 'Choose a work category for each ticked line.' : null)}
        submitLabel="Save work lines"
        submitDisabled={categories === null || changes.length === 0 || unpicked}
        onClose={() => setLinesOpen(false)}
        onSubmit={saveLines}
      >
        {categories === null ? (
          <Small>Loading your categories…</Small>
        ) : (
          <WorkLineOptions
            lines={draftRows}
            categories={categories}
            openLine={openLine}
            total={total}
            onToggle={toggle}
            onOpen={setOpenLine}
            onPick={(lineNumber, categoryId) => {
              setDraft({ ...draft, [lineNumber]: categoryId });
              setOpenLine(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
