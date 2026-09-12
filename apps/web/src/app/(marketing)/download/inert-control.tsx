/**
 * A download control that is visibly present, focusable, and announced by
 * assistive tech as unavailable — but genuinely cannot be activated.
 *
 * Deliberately NOT `<button disabled>`: a disabled button is pulled out of
 * the accessibility tree entirely, so a screen reader user tabbing through
 * the page does not even learn it exists. Deliberately NOT a bare `<a>` with
 * no `href` either — that is not a link at all, and communicates nothing.
 *
 * Instead this is a `<span>` with `role="button"`, `tabIndex={0}` (so Tab
 * still stops on it) and `aria-disabled="true"` (so AT announces "button,
 * dimmed/unavailable" rather than silently skipping it), and — this is the
 * part that actually matters — no click handler and no href of any kind. A
 * click, an Enter, or a Space on this element does precisely nothing,
 * because nothing was ever wired to listen for them. There is no JS on this
 * component at all; it needs none, which also keeps it server-rendered and
 * crawlable.
 */
export function InertDownloadControl({
  label,
  statusText,
}: {
  label: string;
  statusText: string;
}) {
  return (
    <div>
      <span
        role="button"
        tabIndex={0}
        aria-disabled="true"
        className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-rule-strong)] bg-[var(--color-surface-alt)] text-[16px] font-semibold text-[var(--color-ink-faint)]"
      >
        {label}
      </span>
      <p className="mt-2 text-center text-[12px] font-semibold text-[var(--color-ink-muted)]">
        {statusText}
      </p>
    </div>
  );
}
