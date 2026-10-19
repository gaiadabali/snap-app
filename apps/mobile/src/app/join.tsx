import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type MemberRole } from '@/api';
import { useSession } from '@/session';
import { useWorkspace } from '@/workspace';
import { Avatar } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Card, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { space, usePalette } from '@/theme';

/**
 * Accepting an invitation.
 *
 * Reached from the link in the email: `snapapps://join/<token>` or the https
 * equivalent. The token is the credential, so the screen shows what is on
 * offer and requires a deliberate tap — an invitation that auto-accepted on
 * open would let a mis-forwarded email add someone silently.
 *
 * The disclosure notice is not boilerplate. Joining a workspace exposes
 * somebody's financial records to a new person, which under the Privacy Act is
 * a disclosure that the person doing it should understand before it happens.
 */
export default function JoinScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh: refreshSession } = useSession();
  const { refresh: refreshWorkspaces } = useWorkspace();
  const { token, workspace, role, inviter } = useLocalSearchParams<{
    token?: string;
    workspace?: string;
    role?: string;
    inviter?: string;
  }>();

  const [state, setState] = useState<'offer' | 'joining' | 'joined' | 'invalid'>(
    token ? 'offer' : 'invalid',
  );
  const [problem, setProblem] = useState<string | null>(null);
  // What the link CLAIMED, replaced by what the server actually granted once
  // the token is redeemed. A link can say anything; only the response is true.
  const [joined, setJoined] = useState<{ name: string; role: MemberRole } | null>(null);

  const workspaceName = joined?.name ?? workspace ?? 'a workspace';
  const roleLabel = joined?.role ?? role ?? 'member';

  async function accept() {
    if (!token) return;
    setState('joining');
    setProblem(null);
    try {
      const result = await api().acceptInvitation(token);
      setJoined({ name: result.workspace.name, role: result.role });
      // The workspace list has changed, so the switcher is refreshed before
      // the user can reach it — otherwise "Open it" lands on a workspace the
      // app does not yet believe they belong to.
      await Promise.all([refreshSession(), refreshWorkspaces()]);
      setState('joined');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : null);
      setState('invalid');
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {state === 'invalid' ? (
          <Card tone="risk">
            <View style={{ gap: space.xs }}>
              <Label style={{ color: p.risk }}>This link cannot be used</Label>
              <Body>
                {problem ??
                  'It may have expired, been revoked, or already been accepted. Invitations last seven days — ask whoever invited you to send another.'}
              </Body>
            </View>
          </Card>
        ) : state === 'joined' ? (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>You have joined</HeroLabel>
                <HeroFigure small>{workspaceName}</HeroFigure>
                <HeroBody>Switch to it any time from the workspace selector.</HeroBody>
              </View>
            </GradientHero>
            <Button label="Open it" onPress={() => router.replace('/')} />
          </>
        ) : (
          <>
            <View style={{ alignItems: 'center', gap: space.md }}>
              <Avatar initials={workspaceName.slice(0, 2).toUpperCase()} size={64} />
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Small>{inviter ? `${inviter} invited you to` : 'You have been invited to'}</Small>
                <Figure size="h1">{workspaceName}</Figure>
                <Chip tone="accent">as {roleLabel}</Chip>
              </View>
            </View>

            <Raised style={{ gap: space.sm }}>
              <Label>What joining means</Label>
              <Body>
                You will see everything in this workspace: every receipt, every amount, and every
                invoice — including entries made before you joined.
              </Body>
              <Small>
                Whoever runs the workspace can change your role or remove you later. Anything you
                capture belongs to the workspace and stays there if you leave.
              </Small>
            </Raised>

            <Button
              label="Join this workspace"
              busy={state === 'joining'}
              onPress={() => {
                void accept();
              }}
            />
            <Button label="Not now" tone="outline" onPress={() => router.replace('/')} />

            <Small style={{ textAlign: 'center' }}>
              Accepting is recorded against your account and shown to the workspace owner.
            </Small>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
