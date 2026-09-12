/**
 * People data access — platform admin.
 *
 * FIXTURE-BACKED, deliberately. The admin backend (a new staff/identity table
 * and a `SECURITY DEFINER` cross-tenant read path — see docs/WEB.md §6 and
 * `packages/db/migrations/0015_identity_plane.sql`) is being built in
 * parallel and had no routes at the time this was written. Every exported
 * function here is typed and named so that the body — currently a read of
 * `../_fixtures/seed.ts` — becomes an `api<T>('/v1/admin/users...')` call
 * without any caller (a page, a server action) needing to change.
 *
 * Billing/wallet fields are honest about `docs/WEB.md` §7: `subscriptions`
 * and `usage_counters` exist in schema but Stripe is phase 6.5 and unbuilt,
 * so `walletState` is always `'not_wired'` here — never invent a checkout.
 */
import 'server-only';

import type { MemberRole, Workspace } from '@snap/api-contract';

import { FIRMS, TENANTS, USERS, activityFor, signInHistoryFor, type UserSeed } from '../_fixtures/seed';

export type UserStatus = 'active' | 'dormant' | 'suspended';

export type UserWorkspaceMembership = {
  tenantId: string;
  tenantName: string;
  kind: Workspace;
  role: MemberRole;
  firmName: string | null;
};

export type UserListRow = {
  id: string;
  displayName: string;
  email: string;
  initials: string;
  status: UserStatus;
  createdAt: string;
  lastSignInAt: string | null;
  signInCount: number;
  workspaceCount: number;
  primaryWorkspace: string | null;
  planName: string | null;
};

export type WalletState = {
  /** Always false today — Stripe is phase 6.5 and unbuilt. Never invent a checkout. */
  billingWired: false;
  note: string;
};

export type UserDetail = UserListRow & {
  workspaces: UserWorkspaceMembership[];
  signInHistory: Array<{ at: string; ip: string; device: string; outcome: 'success' | 'failed' }>;
  activity: Array<{ at: string; action: string; detail: string }>;
  plan: { planCode: string; planName: string; scanQuota: number | null; scansUsed: number; scansRemaining: number | null } | null;
  wallet: WalletState;
};

export type UserListParams = {
  query?: string;
  status?: UserStatus | 'all';
  tenantId?: string;
  page?: number;
  pageSize?: number;
};

function tenantOf(tenantId: string) {
  return TENANTS.find((t) => t.id === tenantId) ?? null;
}

function firmNameOf(firmId: string | null): string | null {
  return firmId ? (FIRMS.find((f) => f.id === firmId)?.name ?? null) : null;
}

function workspacesOf(u: UserSeed): UserWorkspaceMembership[] {
  return u.memberships
    .map((m) => {
      const tenant = tenantOf(m.tenantId);
      if (!tenant) return null;
      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        kind: tenant.kind,
        role: m.role,
        firmName: firmNameOf(tenant.firmId),
      } satisfies UserWorkspaceMembership;
    })
    .filter((x): x is UserWorkspaceMembership => x !== null);
}

function toRow(u: UserSeed): UserListRow {
  const primary = tenantOf(u.memberships[0]?.tenantId ?? '');
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    initials: u.initials,
    status: u.status,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
    signInCount: u.signInCount,
    workspaceCount: u.memberships.length,
    primaryWorkspace: primary?.name ?? null,
    planName: primary?.planName ?? null,
  };
}

export async function listUsers(
  params: UserListParams = {},
): Promise<{ items: UserListRow[]; total: number }> {
  const { query = '', status = 'all', tenantId, page = 1, pageSize = 50 } = params;
  const q = query.trim().toLowerCase();
  let rows = USERS.filter((u) => (tenantId ? u.memberships.some((m) => m.tenantId === tenantId) : true)).map(toRow);
  if (q) {
    rows = rows.filter((r) => r.displayName.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }
  if (status !== 'all') rows = rows.filter((r) => r.status === status);
  rows.sort((a, b) => (b.lastSignInAt ?? '').localeCompare(a.lastSignInAt ?? ''));
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total };
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const u = USERS.find((x) => x.id === id);
  if (!u) return null;
  const primary = tenantOf(u.memberships[0]?.tenantId ?? '');
  return {
    ...toRow(u),
    workspaces: workspacesOf(u),
    signInHistory: signInHistoryFor(u.id),
    activity: activityFor(u.id),
    plan: primary
      ? {
          planCode: primary.planCode,
          planName: primary.planName,
          scanQuota: primary.scanQuota,
          scansUsed: primary.scansUsed,
          scansRemaining: primary.scanQuota === null ? null : Math.max(0, primary.scanQuota - primary.scansUsed),
        }
      : null,
    wallet: {
      billingWired: false,
      note: 'Stripe integration is phase 6.5 and unbuilt. subscriptions and usage_counters exist in schema; no payment method or invoice history can be shown yet.',
    },
  };
}

export type PaletteHit = { id: string; label: string; sublabel: string; href: string };

/** Bounded client-side index for the command palette — see the same note in tenants.ts. */
export async function searchUsersForPalette(limit = 200): Promise<PaletteHit[]> {
  return USERS.slice(0, limit).map((u) => ({
    id: u.id,
    label: u.displayName,
    sublabel: u.email,
    href: `/admin/people/${u.id}`,
  }));
}
