import { ForbiddenException } from '@nestjs/common';

import { listMembers } from '../repo.js';

async function roleOf(userId: string, tenantId: string): Promise<string | undefined> {
  const members = await listMembers(userId, tenantId);
  return members.find((m) => m.user_id === userId)?.role;
}

/** Workspace and category settings are an owner or manager action (403 otherwise). */
export async function requireOwnerOrAdmin(userId: string, tenantId: string): Promise<void> {
  const role = await roleOf(userId, tenantId);
  if (role !== 'owner' && role !== 'admin') {
    throw new ForbiddenException('Changing these settings is an owner or manager action.');
  }
}

/** A read-only member may look, not file. */
export async function requireNotReadonly(userId: string, tenantId: string): Promise<void> {
  if ((await roleOf(userId, tenantId)) === 'readonly') {
    throw new ForbiddenException('A read-only member cannot change a receipt’s category.');
  }
}
