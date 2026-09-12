import 'server-only';

import { cache } from 'react';
import type { Permissions } from '@snap/api-contract';

import { api } from '@/lib/api/server';

/**
 * What the signed-in person may do in ONE workspace.
 *
 * Resolved server-side and never derived from a role string in a component —
 * `docs/WEB.md` §"Role gates are real": a Staff member cannot post to the
 * ledger, and the UI must say why rather than merely hiding the button. This
 * is the "why": a page reads `Permissions` and renders a disabled control
 * with the reason, while the server-side guard is what actually stops the
 * write if a client ever tried anyway.
 *
 * Cached per (request, workspace) so a page that needs it for both the nav
 * and a form does not fetch it twice.
 */
export const getPermissions = cache(async (workspaceId: string): Promise<Permissions> => {
  return api<Permissions>(`/v1/workspaces/${workspaceId}/permissions`, { workspaceId });
});

/** A sentence explaining a gate a Permissions field represents — reused wherever a control is disabled. */
export const PERMISSION_REASON: Record<keyof Permissions, string> = {
  canCapture: 'Your role here cannot add documents.',
  canEdit: 'Your role here is read-only.',
  canConfirm: 'Posting to the ledger is an owner or manager action.',
  canInvite: 'Only an owner or manager can invite people.',
  canManageBudgets: 'Only an owner or manager can change budgets.',
  canBill: 'Only an owner or manager can record money in or out.',
};
