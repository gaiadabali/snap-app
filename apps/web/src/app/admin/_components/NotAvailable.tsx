/**
 * A UI element the fixture used to show plausible invented data for, and the
 * real admin plane simply has no endpoint for yet.
 *
 * Per the wiring rules for this surface: never invent, estimate, or silently
 * default a value a human might act on. Where a field has no server backing,
 * this says exactly what is missing rather than rendering nothing (which
 * reads as "there is nothing here" instead of "this isn't built yet") or a
 * plausible-looking number (which reads as real).
 */
export function NotAvailable({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] bg-[var(--color-ground)] p-4">
      <div className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
        {title} — not available yet
      </div>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{reason}</p>
    </div>
  );
}
