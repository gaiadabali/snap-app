'use client';

import { useState, useTransition } from 'react';
import type { CategorySetting, DocumentView } from '@snap/api-contract';
import { formatAud, splitLinesCents } from '@snap/api-contract/receipt-split';
import { isTaxCategory, pickerGroups, taxCategoryHint, workExpenseStatus, workLinesSplit } from '@snap/api-contract/work-expense';

import { Button, Card, Field, Select } from '@/design/primitives';
import { setDocumentCategory, setLineCategories } from '@/lib/panels/document-actions';
import type { ActionResult } from '@/lib/panels/actions';

const NONE = '';

/**
 * Is this receipt a work expense? The web twin of the phone's WorkExpenseCard.
 *
 * A receipt goes to Free Tax Returns when a person files it in a category of their personal
 * space that carries an ATO label (the "Work …" categories, Donations, Tax help, Income
 * protection, or their own given a label). Separate from "Save corrections": filing is not a
 * correction of what was read, so it stays open after the receipt is confirmed.
 *
 * "Work lines" files single lines in a work category of their own (one work item on a
 * supermarket docket): they count what was paid for them, GST included, and the rest of the
 * receipt follows its category (docs/DEDUCTIONS.md).
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

      {(document.lines ?? []).length > 0 ? (
        <WorkLines document={document} categories={categories} canEdit={canEdit} workspaceId={workspaceId} path={path} />
      ) : null}
    </Card>
  );
}

/** Ticks single lines as work and picks a work category for each, with the running total. */
function WorkLines({
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
  /** Line number to category id; '' is ticked with no category chosen yet, null is unticked. */
  const [draft, setDraft] = useState<Record<number, string | null>>({});
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const lines = document.lines ?? [];
  const tax = pickerGroups(categories, null).tax;
  const nameOf = (id: string | null) =>
    id ? (categories.find((c) => c.id === id)?.name ?? lines.find((l) => l.categoryId === id)?.category ?? 'Work category') : null;
  const valueOf = (lineNumber: number, saved: string | null | undefined): string | null =>
    lineNumber in draft ? (draft[lineNumber] ?? null) : (saved ?? null);
  const clean = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v || null]));
  const split = workLinesSplit(document, clean);
  const paidOf = (lineNumber: number) => formatAud(split.lines.find((l) => l.lineNumber === lineNumber)?.paidCents ?? 0n);
  const changes = lines
    .filter((l) => l.lineNumber in draft && (draft[l.lineNumber] || null) !== (l.categoryId ?? null))
    .map((l) => ({ lineNumber: l.lineNumber, categoryId: draft[l.lineNumber] || null }));
  const unpicked = Object.values(draft).some((v) => v === '');

  /** A newly ticked line takes the last work category chosen, else the receipt's own (if it is one). */
  const startCategory = (): string => {
    const chosen = [...Object.values(draft), ...lines.map((l) => l.categoryId ?? null)].filter((v): v is string => Boolean(v));
    if (chosen.length > 0) return chosen[chosen.length - 1]!;
    const own = categories.find((c) => c.id === document.categoryId);
    return own && isTaxCategory(own) ? own.id : '';
  };

  const save = () =>
    start(async () => {
      const r = await setLineCategories(workspaceId, document.id, path, changes, document.version);
      setResult(r);
      if (r.ok) setDraft({});
    });

  if (!canEdit) {
    const marked = lines.filter((l) => l.categoryId);
    if (marked.length === 0) return null;
    return (
      <div className="mt-4 border-t border-[var(--color-rule)] pt-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">Work lines</h3>
        <ul className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          {marked.map((l) => (
            <li key={l.lineNumber}>
              {l.description} · {paidOf(l.lineNumber)} · {nameOf(l.categoryId ?? null)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form
      className="mt-4 border-t border-[var(--color-rule)] pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset disabled={pending}>
        <legend className="text-[13px] font-semibold text-[var(--color-ink)]">Work lines</legend>
        <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
          Bought something for work with other shopping? Tick that line and choose its work category. Only ticked lines go
          to Free Tax Returns; the rest of the receipt follows the category above.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {lines.map((l) => {
            const value = valueOf(l.lineNumber, l.categoryId);
            const on = value !== null;
            const id = `work-line-${l.lineNumber}`;
            return (
              <li key={l.lineNumber} className="flex flex-col gap-1">
                <label htmlFor={id} className="flex min-h-[32px] items-center gap-2 text-[14px] text-[var(--color-ink)]">
                  <input
                    id={id}
                    type="checkbox"
                    className="h-4 w-4"
                    checked={on}
                    onChange={(e) => setDraft({ ...draft, [l.lineNumber]: e.target.checked ? startCategory() : null })}
                  />
                  <span className={on ? 'font-semibold' : undefined}>{l.description}</span>
                  <span className="ml-auto tabular-nums">{paidOf(l.lineNumber)}</span>
                </label>
                {on ? (
                  <Select
                    aria-label={`Work category for ${l.description}`}
                    className="ml-6"
                    value={value ?? ''}
                    onChange={(e) => setDraft({ ...draft, [l.lineNumber]: e.target.value })}
                  >
                    <option value="" disabled>
                      Choose a work category
                    </option>
                    {tax.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[14px] font-semibold text-[var(--color-ink)]" aria-live="polite">
          Marked for work: {formatAud(splitLinesCents(split))}{' '}
          <span className="font-normal text-[var(--color-ink-muted)]">(GST included)</span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" disabled={pending || changes.length === 0 || unpicked}>
            {pending ? 'Saving…' : 'Save work lines'}
          </Button>
          {unpicked ? <span className="text-[13px] text-[var(--color-ink-muted)]">Choose a work category for each ticked line.</span> : null}
          {result && !result.ok ? <span className="text-[13px] text-[var(--color-risk)]">{result.message}</span> : null}
          {result?.ok && !pending ? <span className="text-[13px] text-[var(--color-good)]">Saved.</span> : null}
        </div>
      </fieldset>
    </form>
  );
}
