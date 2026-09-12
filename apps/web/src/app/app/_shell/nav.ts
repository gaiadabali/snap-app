/**
 * Nav item lists for the two panels.
 *
 * Plain data — no fetching, no auth — so it can be imported from both a
 * server layout and the client-side sidebar that highlights the active link.
 */
export type NavItem = { href: string; label: string };

export const INDIVIDUAL_NAV: NavItem[] = [
  { href: '/app', label: 'Overview' },
  { href: '/app/documents', label: 'Documents' },
  { href: '/app/categories', label: 'Categories & budgets' },
  { href: '/app/analytics', label: 'Analytics' },
  { href: '/app/mileage', label: 'Mileage' },
  { href: '/app/goals', label: 'Goals' },
  { href: '/app/plan', label: 'Plan & usage' },
  { href: '/app/connections', label: 'Connections' },
  { href: '/app/settings', label: 'Settings' },
];

export const BUSINESS_NAV: NavItem[] = [
  { href: '/app/business', label: 'Overview' },
  { href: '/app/business/documents', label: 'Documents' },
  { href: '/app/business/bills', label: 'Bills' },
  { href: '/app/business/sales', label: 'Invoices & sales' },
  { href: '/app/business/ledger', label: 'Ledger' },
  { href: '/app/business/bas', label: 'BAS & GST' },
  { href: '/app/business/tax-pack', label: 'Tax pack' },
  { href: '/app/business/people', label: 'People & roles' },
  { href: '/app/business/stock', label: 'Stock' },
  { href: '/app/business/recurring', label: 'Recurring' },
  { href: '/app/business/connections', label: 'Connections' },
  { href: '/app/business/plan', label: 'Plan & usage' },
  { href: '/app/business/settings', label: 'Settings' },
];
