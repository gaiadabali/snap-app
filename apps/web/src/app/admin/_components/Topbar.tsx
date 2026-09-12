import type { PlatformStaffRole } from '@snap/api-contract';

import { Badge } from '@/design/primitives';

import { CommandPalette, type PaletteHit } from './CommandPalette';
import { ThemeToggle } from './ThemeToggle';

const ROLE_LABEL: Record<PlatformStaffRole, string> = {
  support: 'Support',
  billing: 'Billing',
  operations: 'Operations',
  super_admin: 'Super admin',
};

/**
 * `GET /v1/admin/me` (migration 0023's `admin_my_capabilities`) now carries
 * the signed-in staff member's own `displayName`/`email`, joined from
 * `users` — previously it was `{ staffId, role, capabilities }` only, so this
 * showed a role badge and an id prefix. Falls back to the id prefix only for
 * a `users` row with no `display_name` on file.
 */
export function Topbar({
  role,
  staffId,
  displayName,
  index,
}: {
  role: PlatformStaffRole;
  staffId: string;
  displayName: string | null;
  index: PaletteHit[];
}) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-[var(--color-rule)] bg-[var(--color-surface)] px-4">
      <CommandPalette index={index} />
      <div className="ml-auto flex items-center gap-3">
        <Badge tone="accent">{ROLE_LABEL[role]}</Badge>
        {displayName ? (
          <span className="text-[13px] font-semibold text-[var(--color-ink)]">{displayName}</span>
        ) : null}
        <span className="font-mono text-[12px] text-[var(--color-ink-muted)]" title="Staff id">
          {staffId.slice(0, 8)}…
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
