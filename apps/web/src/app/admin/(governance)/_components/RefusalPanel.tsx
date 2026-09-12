import type { PlatformCapability } from '@snap/api-contract';

import { Card } from '@/design/primitives';

/**
 * What a `Gated<T>` with `allowed: false` renders as.
 *
 * A 403 from the admin plane means "this staff member lacks a specific,
 * named capability" — not a fault, and never a blank table or a generic
 * error page (docs/WEB.md §6, and the mission brief: "must render as a clear
 * refusal panel naming the capability"). The database re-checks the same
 * capability independently of this guard existing at all, so this panel is a
 * courtesy explanation, not the security boundary.
 */
export function RefusalPanel({
  capability,
  status,
  message,
}: {
  /** The capability the database refused this on, e.g. "manage_ai_config". */
  capability: PlatformCapability | string;
  status: 401 | 403;
  message: string;
}) {
  return (
    <Card tone="ground" className="border-[var(--color-risk)]">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-[20px] leading-none text-[var(--color-risk)]">
          ⛔
        </span>
        <div>
          <h3 className="text-[16px] font-bold text-[var(--color-risk)]">
            {status === 401 ? 'Sign in required' : 'Not permitted'}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            {status === 401
              ? message
              : `This panel requires the "${capability}" capability, and your platform-staff account does not have it.`}
          </p>
          {status === 403 ? (
            <p className="mt-2 text-[12px] text-[var(--color-ink-faint)]">
              Refused by the database, independently of this screen — see <code>staff_has_capability</code>{' '}
              in <code>packages/db/migrations/0021_admin_plane.sql</code>. A staff member with{' '}
              <code>manage_staff</code> can grant <code>{capability}</code> from the staff console.
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
