/**
 * People data access — platform admin, wired to the real admin plane.
 *
 * Backed by `GET /v1/admin/users` (`admin_user_search` — 0021_admin_plane.sql),
 * which matches a name/email substring and is gated on `view_tenant_metadata`.
 * Every row is exactly `AdminUserSummary` from `@snap/api-contract` — no
 * richer shape is invented here. See the wiring report for the full list of
 * fields the previous fixture showed that have no server backing at all
 * (status, last sign-in, sign-in count, primary workspace, plan name,
 * workspace list, sign-in history, activity feed, wallet).
 */
import 'server-only';

import type { AdminUserDetail, AdminUserSummary } from '@snap/api-contract';

import { ApiError, adminApi, capabilityGated, type Gated } from './client';

export type UserListParams = { query?: string; page?: number; pageSize?: number };

/** Clamped server-side too (`admin.repo.ts`'s `clampLimit`) — mirrored here
 * only so pagination math matches what the server will actually apply. */
const MAX_PAGE_SIZE = 100;

export async function listUsers(
  params: UserListParams = {},
): Promise<Gated<{ items: AdminUserSummary[]; hasMore: boolean }>> {
  const { query = '', page = 1, pageSize = 50 } = params;
  const limit = Math.min(Math.max(Math.trunc(pageSize), 1), MAX_PAGE_SIZE);
  const offset = Math.max(0, (page - 1) * limit);
  return capabilityGated(async () => {
    const items = await adminApi<AdminUserSummary[]>(
      `/v1/admin/users?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
    );
    return { items, hasMore: items.length === limit };
  });
}

/**
 * There is no `GET /v1/admin/users/:userId` — `admin_user_search` only
 * matches a name/email substring and cannot fetch by id. Migration 0022 adds
 * `admin_user_detail`, so a single user is now ONE request that also carries
 * their memberships — replacing a scan that made twenty round trips per page
 * and silently found nobody once the user table outgrew its bound.
 */
export async function getUser(userId: string): Promise<Gated<AdminUserDetail | null>> {
  return capabilityGated(async () => {
    try {
      return await adminApi<AdminUserDetail>(`/v1/admin/users/${encodeURIComponent(userId)}`);
    } catch (error) {
      // The function raises `no such user` rather than returning an empty
      // row, so an unknown id arrives as a 404 and is a legitimate "not
      // found" for the page to render — not a fault to propagate.
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  });
}

export type PaletteHit = { id: string; label: string; sublabel: string; href: string };

/** Bounded client-side index for the command palette. Empty (not thrown) when
 * the signed-in staff member lacks `view_tenant_metadata` — the palette
 * degrades quietly rather than breaking the whole shell over one section. */
export async function searchUsersForPalette(limit = 200): Promise<PaletteHit[]> {
  const gated = await capabilityGated(() => adminApi<AdminUserSummary[]>(`/v1/admin/users?limit=${limit}`));
  if (!gated.allowed) return [];
  return gated.data.map((u) => ({
    id: u.userId,
    label: u.displayName ?? u.email ?? u.userId,
    sublabel: u.email ?? u.userId,
    href: `/admin/people/${u.userId}`,
  }));
}
