import { createHash } from 'node:crypto';

import { asUser, withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';

/**
 * The database half of teen spaces (migration 0045). Every write is one of
 * its SECURITY DEFINER functions; reads go through `teen_spaces` and
 * `teen_invites` under RLS.
 */

const codeHash = (code: string) => createHash('sha256').update(code, 'utf8').digest();

/** The parent keeps the invite YourTal made, and the workspace that pays for the teen's scans. */
export async function recordInvite(
  parentUserId: string,
  input: { inviteId: string; fundingTenantId: string; code: string; expiresAt: string },
): Promise<void> {
  await asUser(getDb(), parentUserId, async (tx) => {
    await tx.execute(sql`
      select teen_invite_record(${input.inviteId}::uuid, ${input.fundingTenantId}::uuid,
                                ${codeHash(input.code)}, ${input.expiresAt}::timestamptz)
    `);
  });
}

/** At start: the sign-in flow carries the invite. Null for a code this server never issued, or one past its expiry. */
export async function attachInviteToFlow(code: string, flowId: string): Promise<string | null> {
  const { rows } = await getDb().execute<{ id: string | null }>(sql`
    select teen_invite_attach_flow(${codeHash(code)}, ${flowId}::uuid) as id
  `);
  return rows[0]?.id ?? null;
}

/** At finish: the invite to check with YourTal (the standing space's, else this sign-in's). */
export async function inviteForSignIn(flowId: string, sub: string): Promise<string | null> {
  const { rows } = await getDb().execute<{ id: string | null }>(sql`
    select teen_invite_for_sign_in(${flowId}::uuid, ${`yourtal|${sub}`}) as id
  `);
  return rows[0]?.id ?? null;
}

/** True when a teen's `sub` is new here and an account already holds their email: never linked (0045). */
export async function teenEmailTaken(sub: string, email: string): Promise<boolean> {
  const { rows } = await getDb().execute<{ taken: boolean }>(sql`
    select teen_sign_in_email_taken(${`yourtal|${sub}`}, ${email}) as taken
  `);
  return rows[0]?.taken === true;
}

/**
 * The teen's space, made on first use through the flow YourTal confirmed.
 * Throws TS002 (access ended, or no invite on the flow) or TS003 (already uses
 * other workspaces).
 */
export async function joinTeenSpace(
  teenUserId: string,
  input: { flowId: string; name: string; region: 'AU' | 'ID' },
): Promise<{ tenantId: string; created: boolean }> {
  return asUser(getDb(), teenUserId, async (tx) => {
    const { rows } = await tx.execute<{ tenant_id: string; created: boolean }>(sql`
      select tenant_id, created from teen_space_join(${input.flowId}::uuid, ${input.name}, ${input.region})
    `);
    return { tenantId: rows[0]!.tenant_id, created: rows[0]!.created };
  });
}

/** YourTal confirmed the invite ended: the queued `teen_invite_end` job has nothing left to do. */
export async function markYourtalEnded(parentUserId: string, inviteId: string): Promise<void> {
  await asUser(getDb(), parentUserId, async (tx) => {
    await tx.execute(sql`select teen_invite_yourtal_ended(${inviteId}::uuid)`);
  });
}

/** False when a teen space's scans can no longer be paid (0045 TS004); null outside a teen space. */
export async function teenSpaceFunded(userId: string, tenantId: string): Promise<boolean | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ funded: boolean | null }>(sql`select teen_space_funded() as funded`);
    return rows[0]?.funded ?? null;
  });
}

/** Whether the space has any categories yet (setup after a join is redone until it does). */
export async function hasCategories(userId: string, tenantId: string): Promise<boolean> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ any: boolean }>(sql`
      select exists (select 1 from categories where tenant_id = current_tenant_id()) as any
    `);
    return rows[0]?.any === true;
  });
}

/** True when this account is a teen's (it has a teen space). */
export async function isTeen(userId: string): Promise<boolean> {
  return asUser(getDb(), userId, async (tx) => {
    const { rows } = await tx.execute<{ teen: boolean }>(sql`
      select exists (select 1 from teen_spaces where teen_user_id = current_user_id()) as teen
    `);
    return rows[0]?.teen === true;
  });
}

/** True when the workspace is a teen's space. */
export async function isTeenSpace(userId: string, tenantId: string): Promise<boolean> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ teen: boolean }>(sql`
      select exists (select 1 from teen_spaces where tenant_id = current_tenant_id()) as teen
    `);
    return rows[0]?.teen === true;
  });
}

/** A space this parent invited, or null. */
export async function spaceOfParent(
  parentUserId: string,
  tenantId: string,
): Promise<{ inviteId: string; accessEndedAt: string | null; yourtalEnded: boolean } | null> {
  return asUser(getDb(), parentUserId, async (tx) => {
    const { rows } = await tx.execute<{ invite_id: string; access_ended_at: string | null; yourtal_ended: boolean }>(sql`
      select invite_id, to_json(access_ended_at)#>>'{}' as access_ended_at, yourtal_ended_at is not null as yourtal_ended
        from teen_spaces
       where tenant_id = ${tenantId}::uuid and parent_user_id = current_user_id()
    `);
    const row = rows[0];
    return row ? { inviteId: row.invite_id, accessEndedAt: row.access_ended_at, yourtalEnded: row.yourtal_ended } : null;
  });
}

/**
 * Ends access here, in one transaction: the teen's sessions end, the hold
 * starts, and a `teen_invite_end` job is queued until YourTal confirms. Run
 * again on an ended space, it only makes sure that job exists. False when
 * access had already ended.
 */
export async function endTeenSpace(parentUserId: string, tenantId: string): Promise<boolean> {
  return asUser(getDb(), parentUserId, async (tx) => {
    const { rows } = await tx.execute<{ ended: boolean }>(sql`select teen_space_end(${tenantId}::uuid) as ended`);
    return rows[0]?.ended === true;
  });
}

export type FamilyRows = {
  teens: Array<{ workspaceId: string; teenName: string | null; joinedAt: string; accessEndedAt: string | null }>;
  pendingInvites: Array<{ inviteId: string; expiresAt: string }>;
  asTeen: { workspaceId: string; parentName: string | null } | null;
};

/** Display name of another member of `tenantId`, readable only inside it (users RLS). */
async function memberName(userId: string, tenantId: string, otherId: string | null): Promise<string | null> {
  if (!otherId) return null;
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ name: string | null }>(sql`
      select display_name as name from users where id = ${otherId}::uuid
    `);
    return rows[0]?.name ?? null;
  });
}

export async function familyOf(userId: string): Promise<FamilyRows> {
  const { spaces, invites } = await asUser(getDb(), userId, async (tx) => {
    const spaces = await tx.execute<{
      tenant_id: string;
      teen_user_id: string;
      parent_user_id: string | null;
      created_at: string;
      access_ended_at: string | null;
    }>(sql`
      select tenant_id, teen_user_id, parent_user_id, to_json(created_at)#>>'{}' as created_at,
             to_json(access_ended_at)#>>'{}' as access_ended_at
        from teen_spaces
       where teen_user_id = current_user_id() or parent_user_id = current_user_id()
       order by created_at
    `);
    const invites = await tx.execute<{ id: string; expires_at: string }>(sql`
      select id, to_json(expires_at)#>>'{}' as expires_at
        from teen_invites
       where parent_user_id = current_user_id() and expires_at > now()
       order by created_at
    `);
    return { spaces: spaces.rows, invites: invites.rows };
  });

  const own = spaces.find((s) => s.teen_user_id === userId) ?? null;
  const teens = await Promise.all(
    spaces
      .filter((s) => s.parent_user_id === userId)
      .map(async (s) => ({
        workspaceId: s.tenant_id,
        teenName: await memberName(userId, s.tenant_id, s.teen_user_id),
        joinedAt: s.created_at,
        accessEndedAt: s.access_ended_at,
      })),
  );
  return {
    teens,
    pendingInvites: invites.map((i) => ({ inviteId: i.id, expiresAt: i.expires_at })),
    asTeen:
      own && !own.access_ended_at
        ? { workspaceId: own.tenant_id, parentName: await memberName(userId, own.tenant_id, own.parent_user_id) }
        : null,
  };
}

/** The credits a teen's scans can still spend (the parent's), or null outside a teen space. */
export async function teenSpaceCredits(userId: string, tenantId: string): Promise<number | null> {
  return withTenantAs(getDb(), userId, tenantId, async (tx) => {
    const { rows } = await tx.execute<{ n: number | null }>(sql`select teen_space_credits() as n`);
    return rows[0]?.n ?? null;
  });
}
