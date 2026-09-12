import type { PlatformCapability } from '@snap/api-contract';

/**
 * The admin shell's primary navigation.
 *
 * Governance & AI is a section owned by a different agent building in
 * parallel (`src/app/admin/(governance)/`, docs/WEB.md ownership map §5). The
 * link is listed here because the SHELL is what routes to it — the route
 * itself is not this file's concern and is not built here, so it is
 * deliberately left with no `capability` gate: that surface may need several
 * different capabilities across its own sub-pages, and this file cannot know
 * that. Overview/People/Tenants ARE this agent's routes, and each maps to
 * exactly the one capability its controller requires
 * (`apps/server/src/admin/*.controller.ts`) — the sidebar hides what a staff
 * member genuinely cannot reach, though the real gate is always the server.
 */
export type NavItem = { href: string; label: string; hint: string; capability?: PlatformCapability };

export const PRIMARY_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', hint: 'Platform metrics', capability: 'view_analytics' },
  { href: '/admin/people', label: 'People', hint: 'Users', capability: 'view_tenant_metadata' },
  { href: '/admin/tenants', label: 'Tenants', hint: 'Workspaces', capability: 'view_tenant_metadata' },
  { href: '/admin/audit', label: 'Audit trail', hint: 'Impersonation log' },
  { href: '/admin/governance', label: 'Governance & AI', hint: 'Server control' },
];
