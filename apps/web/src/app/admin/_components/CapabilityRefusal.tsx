/**
 * What a 401/403 from the admin plane renders as.
 *
 * The admin backend refuses per capability, from inside Postgres — see
 * `_data/client.ts`'s `capabilityGated`. A refusal is a normal, expected
 * outcome for a staff member who genuinely lacks a capability, and the UI
 * must say exactly that: not a generic error page, and not a table that
 * silently renders empty as if there were simply nothing to show.
 */
export function CapabilityRefusal({
  title = "You can't see this",
  message,
  status,
}: {
  title?: string;
  message: string;
  status: 401 | 403;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--color-rule-strong)] bg-[var(--color-surface)] p-8 text-center"
    >
      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--color-warn-soft)] text-[var(--color-warn)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      </div>
      <div className="text-[15px] font-semibold text-[var(--color-ink)]">{title}</div>
      <p className="mx-auto mt-2 max-w-[52ch] text-[13px] text-[var(--color-ink-muted)]">
        {status === 401
          ? 'Your session could not be verified. Sign in again.'
          : message}
      </p>
    </div>
  );
}
