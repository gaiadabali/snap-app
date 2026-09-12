import 'server-only';

import type { AuthUser, WorkspaceSummary } from '@snap/api-contract';

import { getActiveWorkspaceId } from '@/lib/api/server';
import { requireSession } from './session';

/**
 * Resolves a workspace KIND to the one workspace it means right now.
 *
 * Mirrors `HttpApi#idForKind` in the mobile app, for the same reason stated
 * there: a kind is not an address. Someone can own two businesses, so "the
 * business workspace" only means something once you also know which one this
 * person last chose — the active-workspace cookie — and only when that choice
 * is still one of theirs and still the right kind.
 *
 * Never trusts the cookie blindly: every panel page passes the returned id
 * explicitly to `api()`, so a stale or foreign cookie value can never widen
 * what a request is scoped to — the server's own `MembershipGuard` is the
 * boundary, this is only about picking the right workspace to ask for.
 */
export function resolveActiveWorkspace(
  workspaces: WorkspaceSummary[],
  kind: 'business' | 'personal',
  activeId?: string,
): WorkspaceSummary | null {
  const ofKind = workspaces.filter((w) => w.kind === kind);
  if (ofKind.length === 0) return null;
  const current = activeId ? ofKind.find((w) => w.id === activeId) : undefined;
  return current ?? ofKind[0]!;
}

/** Convenience for a page that just wants "the active one, whatever it is". */
export async function currentWorkspaceId(): Promise<string | undefined> {
  return getActiveWorkspaceId();
}

/**
 * The one-liner every panel page starts with.
 *
 * `workspace` is `null` when this person has none of the requested kind — the
 * layout above them already handles that case for the section root, but a
 * deep link (a bookmarked review URL, a reload after leaving the only
 * business) can still land a page here directly, and it must answer with a
 * real explanation rather than a crash reading `.id` off `null`.
 */
export async function loadWorkspace(
  kind: 'business' | 'personal',
): Promise<{ user: AuthUser; workspaces: WorkspaceSummary[]; workspace: WorkspaceSummary | null }> {
  const { user, workspaces } = await requireSession();
  const activeId = await getActiveWorkspaceId();
  const workspace = resolveActiveWorkspace(workspaces, kind, activeId);
  return { user, workspaces, workspace };
}
