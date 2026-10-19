import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type MemberList, type MemberRole, type Permissions } from '@/api';
import { AddButton, Avatar, Choice, Empty, Field, Loading, Sheet } from '@/components/form';
import { Body, Chip, Screen, Section, Small } from '@/components/ui';
import { formatShortDate, radius, space, type, usePalette } from '@/theme';
import { useWorkspace } from '@/workspace';

/**
 * Who is in this workspace, and what they may do.
 *
 * The same screen serves a household and a haulage company, because they are
 * the same thing: a set of people with roles against one set of records. Only
 * the words change — a business has managers and staff, a household has
 * partners and family — so the role labels are chosen per workspace kind and
 * the permissions behind them are identical.
 *
 * Rebuilt 2026-10-19 (the instrument pass): people are ledger rows on the
 * ground — avatar, name, a mono role badge — divided by hairlines rather than
 * boxed in a card, and the role key is plain text under a label.
 */

const BUSINESS_ROLES: Array<{ value: MemberRole; label: string; detail: string }> = [
  { value: 'owner', label: 'Owner', detail: 'Everything, including billing' },
  { value: 'admin', label: 'Manager', detail: 'Everything except billing' },
  { value: 'member', label: 'Staff', detail: 'Scan and correct; cannot post to the ledger' },
  { value: 'readonly', label: 'Viewer', detail: 'Read only — for an accountant or bookkeeper' },
];

const PERSONAL_ROLES: Array<{ value: MemberRole; label: string; detail: string }> = [
  { value: 'owner', label: 'Owner', detail: 'Everything, including the plan' },
  { value: 'admin', label: 'Partner', detail: 'Everything except the plan' },
  { value: 'member', label: 'Family', detail: 'Scan and correct; cannot change budgets' },
  { value: 'readonly', label: 'Viewer', detail: 'Read only' },
];

export default function MembersScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { workspaceId, isBusiness, workspaceName } = useWorkspace();
  const [data, setData] = useState<MemberList | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const roles = isBusiness ? BUSINESS_ROLES : PERSONAL_ROLES;
  const roleLabel = (r: MemberRole) => roles.find((x) => x.value === r)?.label ?? r;

  const load = useCallback(async () => {
    const [m, pm] = await Promise.all([
      api().listMembers(workspaceId),
      api().getPermissions(workspaceId),
    ]);
    setData(m);
    setPerms(pm);
  }, [workspaceId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const canInvite = perms?.canInvite ?? false;
  const seatsLeft = data ? data.seatLimit - data.seatsUsed : 0;
  const member = data?.members.find((m) => m.userId === editing) ?? null;

  async function invite() {
    setError(null);
    try {
      setData(await api().inviteMember(workspaceId, email.trim(), role));
      setInviting(false);
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that invitation.');
    }
  }

  async function changeRole(userId: string, next: MemberRole) {
    try {
      setData(await api().updateMemberRole(workspaceId, userId, next));
      setEditing(null);
    } catch (e) {
      Alert.alert('Cannot change that role', e instanceof Error ? e.message : 'Unknown error');
    }
  }

  function confirmRemove(userId: string, name: string) {
    Alert.alert(
      `Remove ${name}?`,
      'They lose access immediately. Everything they captured stays in this workspace — the records belong to it, and a business is required to keep them for five years.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void api()
              .removeMember(workspaceId, userId)
              .then(setData)
              .catch((e: unknown) =>
                Alert.alert('Cannot remove', e instanceof Error ? e.message : 'Unknown error'),
              );
            setEditing(null);
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        {data === null ? (
          <Loading />
        ) : (
          <>
            <View style={{ gap: 2 }}>
              <Text style={[type.h1, { color: p.ink }]}>{workspaceName}</Text>
              <Small>
                {data.members.length} {data.members.length === 1 ? 'person' : 'people'} ·{' '}
                {seatsLeft > 0
                  ? `${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on this plan`
                  : 'no seats left on this plan'}
              </Small>
            </View>

            <Section label="People">
              {data.members.map((m, i) => (
                <Pressable
                  key={m.userId}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.displayName}, ${roleLabel(m.role)}`}
                  onPress={canInvite ? () => setEditing(m.userId) : undefined}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    minHeight: 60,
                    paddingVertical: space.md,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                    backgroundColor: pressed && canInvite ? p.surface : 'transparent',
                  })}
                >
                  <Avatar initials={m.initials} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text
                        style={[type.bodyStrong, { flexShrink: 1, color: p.ink }]}
                        numberOfLines={1}
                      >
                        {m.displayName}
                      </Text>
                      {m.isYou ? <Chip tone="accent">You</Chip> : null}
                    </View>
                    <Small numberOfLines={1}>
                      {m.captureCount} capture{m.captureCount === 1 ? '' : 's'}
                      {m.lastActiveAt ? ` · active ${formatShortDate(m.lastActiveAt)}` : ''}
                    </Small>
                  </View>
                  <Chip tone={m.role === 'owner' ? 'accent' : 'neutral'}>{roleLabel(m.role)}</Chip>
                </Pressable>
              ))}
            </Section>

            {data.invitations.length > 0 ? (
              <Section label="Invited, not yet joined">
                {data.invitations.map((inv, i) => (
                  <View
                    key={inv.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      minHeight: 60,
                      paddingVertical: space.md,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                    }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
                        {inv.email}
                      </Text>
                      <Small>
                        {roleLabel(inv.role)} · invited by {inv.invitedByName} · expires{' '}
                        {formatShortDate(inv.expiresAt)}
                      </Small>
                    </View>
                    {canInvite ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke the invitation to ${inv.email}`}
                        hitSlop={8}
                        style={{ minHeight: 44, justifyContent: 'center' }}
                        onPress={() => {
                          void api().revokeInvitation(workspaceId, inv.id).then(setData);
                        }}
                      >
                        <Text style={[type.smallStrong, { color: p.risk }]}>Revoke</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </Section>
            ) : null}

            {canInvite ? (
              <AddButton
                label={isBusiness ? 'Invite someone to the team' : 'Invite a family member'}
                onPress={() => {
                  setError(null);
                  setInviting(true);
                }}
              />
            ) : (
              <Empty
                title="Only an owner can invite"
                detail="Ask an owner or manager of this workspace to add someone."
              />
            )}

            <Section label="What each role can do" style={{ gap: space.sm }}>
              {roles.map((r) => (
                <View key={r.value} style={{ flexDirection: 'row', gap: space.sm }}>
                  <Body strong style={{ width: 78 }}>
                    {r.label}
                  </Body>
                  <Small style={{ flex: 1 }}>{r.detail}</Small>
                </View>
              ))}
            </Section>

            <Small style={{ textAlign: 'center' }}>
              Inviting someone discloses this workspace&rsquo;s financial records to them. They see
              everything in it from the moment they accept.
            </Small>
          </>
        )}
      </ScrollView>

      {/* Invite */}
      <Sheet
        open={inviting}
        title={isBusiness ? 'Invite to the team' : 'Invite to the household'}
        subtitle="They will be emailed a link that expires in seven days."
        error={error}
        submitLabel="Send invitation"
        submitDisabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
        onClose={() => setInviting(false)}
        onSubmit={invite}
      >
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoFocus
        />
        <View style={{ gap: space.sm }}>
          <Choice
            label="Role"
            value={role}
            onChange={setRole}
            options={roles.map((r) => ({ value: r.value, label: r.label }))}
          />
          <View style={{ backgroundColor: p.surfaceAlt, borderRadius: radius.md, padding: space.md }}>
            <Small muted={false}>{roles.find((r) => r.value === role)?.detail}</Small>
          </View>
        </View>
      </Sheet>

      {/* Change role / remove */}
      <Sheet
        open={member !== null}
        title={member?.displayName ?? ''}
        subtitle={member?.email ?? undefined}
        submitLabel="Done"
        onClose={() => setEditing(null)}
        onSubmit={() => setEditing(null)}
      >
        {member ? (
          <>
            <Choice
              label="Role"
              value={member.role}
              onChange={(next) => void changeRole(member.userId, next)}
              options={roles.map((r) => ({ value: r.value, label: r.label }))}
            />
            <View style={{ backgroundColor: p.surfaceAlt, borderRadius: radius.md, padding: space.md }}>
              <Small muted={false}>{roles.find((r) => r.value === member.role)?.detail}</Small>
            </View>
            {!member.isYou ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmRemove(member.userId, member.displayName)}
                style={{ paddingVertical: space.sm }}
              >
                <Text style={[type.smallStrong, { color: p.risk, textAlign: 'center' }]}>
                  Remove from this workspace
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
