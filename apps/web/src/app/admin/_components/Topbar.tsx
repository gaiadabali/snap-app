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
 * `role` and `staffId` — not a name. `AdminSession` (`GET /v1/admin/me`) is
 * `{ staffId, role, capabilities }`, with no display name or email for the
 * signed-in staff member. A friendlier topbar needs that endpoint (or the
 * session) to carry one; until then this shows what is actually known.
 */
export function Topbar({ role, staffId, index }: { role: PlatformStaffRole; staffId: string; index: PaletteHit[] }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b border-[var(--color-rule)] bg-[var(--color-surface)] px-4">
      <CommandPalette index={index} />
      <div className="ml-auto flex items-center gap-3">
        <Badge tone="accent">{ROLE_LABEL[role]}</Badge>
        <span className="font-mono text-[12px] text-[var(--color-ink-muted)]" title="No staff display name is exposed by GET /v1/admin/me yet">
          {staffId.slice(0, 8)}…
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
