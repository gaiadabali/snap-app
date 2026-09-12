/**
 * The admin shell's primary navigation.
 *
 * Governance & AI is a section owned by a different agent building in
 * parallel (`src/app/admin/(governance)/`, docs/WEB.md ownership map §5). The
 * link is listed here because the SHELL is what routes to it — the route
 * itself is not this file's concern and is not built here.
 */
export type NavItem = { href: string; label: string; hint: string };

export const PRIMARY_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', hint: 'Platform metrics' },
  { href: '/admin/people', label: 'People', hint: 'Users' },
  { href: '/admin/tenants', label: 'Tenants', hint: 'Workspaces' },
  { href: '/admin/audit', label: 'Audit trail', hint: 'Impersonation log' },
  { href: '/admin/governance', label: 'Governance & AI', hint: 'Server control' },
];
