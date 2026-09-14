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
  {
    href: '/admin/audit',
    label: 'Audit trail',
    hint: 'Impersonation log',
    // Wired to `GET /v1/admin/audit-log` (`audit_review`, migration 0023) —
    // see that migration's header for why this is its own capability rather
    // than `view_tenant_metadata`.
    capability: 'audit_review',
  },
  // The governance surface has no index route — the pages are /admin/ai/*,
  // /admin/operations and /admin/settings. A single 'Governance & AI' entry
  // pointed at /admin/governance, which 404s. Listed individually instead:
  // it is honest about what exists, and a reviewer can reach each section
  // without guessing.
  {
    href: '/admin/ai/models',
    label: 'AI models',
    hint: 'Routing & exclusions',
    capability: 'manage_ai_config',
  },
  { href: '/admin/ai/keys', label: 'AI keys', hint: 'Provider credentials', capability: 'manage_ai_config' },
  { href: '/admin/ai/usage', label: 'AI usage', hint: 'Spend & cost', capability: 'manage_ai_config' },
  {
    href: '/admin/operations',
    label: 'Operations',
    hint: 'Queue, retention, replay',
    capability: 'manage_operations',
  },
  {
    href: '/admin/settings',
    label: 'Platform settings',
    hint: 'Flags & defaults',
    capability: 'manage_platform_settings',
  },
];
