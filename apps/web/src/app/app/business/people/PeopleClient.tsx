'use client';

import { useActionState, useTransition } from 'react';
import type { MemberList, MemberRole } from '@snap/api-contract';

import { Badge, Button, Card, Field, Input, Select, Table, Td, Th, Thead, Tr } from '@/design/primitives';
import { formatDate } from '@/lib/panels/format';
import type { ActionResult } from '@/lib/panels/actions';

const ROLES: MemberRole[] = ['owner', 'admin', 'member', 'readonly'];

export function PeopleClient({
  data,
  canInvite,
  onInvite,
  onRevoke,
  onSetRole,
  onRemove,
}: {
  data: MemberList;
  canInvite: boolean;
  onInvite: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  onRevoke: (invitationId: string) => Promise<ActionResult>;
  onSetRole: (userId: string, role: string) => Promise<ActionResult>;
  onRemove: (userId: string) => Promise<ActionResult>;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState<ActionResult | null, FormData>(onInvite, null);
  const [, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-center justify-between text-[13px] text-[var(--color-ink-muted)]">
          <span>
            {data.seatsUsed} of {data.seatLimit} seats used
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <Table>
            <Thead>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Joined</Th>
              <Th></Th>
            </Thead>
            <tbody>
              {data.members.map((m) => (
                <Tr key={m.userId}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[10px] font-bold text-[var(--color-accent)]">
                        {m.initials}
                      </span>
                      {m.displayName}
                      {m.isYou ? <Badge tone="accent">You</Badge> : null}
                    </div>
                  </Td>
                  <Td>
                    {canInvite && !m.isYou ? (
                      <Select
                        defaultValue={m.role}
                        className="h-8"
                        onChange={(e) => startTransition(async () => { await onSetRole(m.userId, e.target.value); })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone="neutral">{m.role}</Badge>
                    )}
                  </Td>
                  <Td className="text-[var(--color-ink-muted)]">{formatDate(m.joinedAt)}</Td>
                  <Td>
                    {canInvite && !m.isYou ? (
                      <button
                        type="button"
                        className="text-[13px] font-medium text-[var(--color-risk)] hover:underline"
                        onClick={() => startTransition(async () => { await onRemove(m.userId); })}
                      >
                        Remove
                      </button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
              {data.invitations.map((inv) => (
                <Tr key={inv.id} className="opacity-70">
                  <Td>{inv.email}</Td>
                  <Td>
                    <Badge tone="warn">invited — {inv.role}</Badge>
                  </Td>
                  <Td className="text-[var(--color-ink-muted)]">by {inv.invitedByName}</Td>
                  <Td>
                    {canInvite ? (
                      <button
                        type="button"
                        className="text-[13px] font-medium text-[var(--color-risk)] hover:underline"
                        onClick={() => startTransition(async () => { await onRevoke(inv.id); })}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>

      {canInvite ? (
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Invite someone</h3>
          <form action={inviteAction} className="flex flex-wrap items-end gap-3">
            <Field label="Email"><Input type="email" name="email" required className="w-[240px]" /></Field>
            <Field label="Role">
              <Select name="role" defaultValue="member">
                {ROLES.filter((r) => r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={invitePending}>
              {invitePending ? 'Sending…' : 'Send invitation'}
            </Button>
            {inviteState && !inviteState.ok ? <span className="text-[13px] text-[var(--color-risk)]">{inviteState.message}</span> : null}
          </form>
        </Card>
      ) : null}
    </div>
  );
}
