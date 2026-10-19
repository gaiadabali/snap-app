import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';

import { Avatar } from '@/components/form';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { Body, Button, Row, Screen, Section, Small } from '@/components/ui';
import { useSession } from '@/session';
import { WorkspacePicker, useWorkspace } from '@/workspace';
import { numeric, space, type, usePalette } from '@/theme';

/**
 * Profile — new in the 2026-09-19 redesign, and now a tab rather than a row
 * buried in the menu.
 *
 * The screen answers three questions in the order people ask them: who am I
 * signed in as, what have I got left, and whose books am I looking at. The two
 * balances are a two-dial readout on the ground (the same instrument Home
 * uses) because they are the only numbers here, and both are tappable: a
 * balance nobody can explain is a support ticket, so each one leads to the
 * ledger that produced it.
 *
 * Rebuilt 2026-10-19 (the instrument pass): the gradient strip and the
 * pastel avatar are gone; the identity block, the readout and the rows all sit
 * on the ground and are divided by hairlines rather than boxed.
 */
export default function ProfileScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { active, workspaces } = useWorkspace();
  const [credits, setCredits] = useState<number | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      // Settled independently: a points outage should not blank the credits
      // dial, which is the one that governs whether scanning still works.
      void api()
        .getCreditBalance()
        .then((b) => live && setCredits(b.creditsRemaining))
        .catch(() => {});
      void api()
        .getPointBalance()
        .then((b) => live && setPoints(b.balance))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, []),
  );

  const user = session?.user;
  const memberWord = active.memberCount === 1 ? 'person' : 'people';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        {/* Identity */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar initials={user?.initials ?? '—'} size={56} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.h1, { color: p.ink }]} numberOfLines={1}>
              {user?.displayName ?? 'Signed out'}
            </Text>
            <Small numberOfLines={1}>{user?.email ?? ''}</Small>
          </View>
          <Button label="Edit" tone="outline" size="sm" onPress={() => router.push('/settings')} />
        </View>

        {/* Balances: two dials, one rule between them. Tapping either leads to
            the ledger that produced it. */}
        <View>
          <View style={{ flexDirection: 'row' }}>
            <Readout
              label="Credits"
              value={credits === null ? '—' : String(credits)}
              unit={credits === 1 ? 'scan left' : 'scans left'}
              onPress={() => router.push({ pathname: '/usage', params: { kind: 'credits' } })}
            />
            <View style={{ width: 1, backgroundColor: p.rule, marginVertical: 4 }} />
            <Readout
              label="Points"
              value={points === null ? '—' : points.toLocaleString('en-AU')}
              unit="for scan credits"
              onPress={() => router.push({ pathname: '/usage', params: { kind: 'points' } })}
              inset
            />
          </View>
          <Small style={{ marginTop: space.md }}>
            Tap a balance to see how it was used: credits spent on scanning, points spent in yourtal.
          </Small>
        </View>

        {/* Active space */}
        <Section label="Workspace">
          <View
            style={{
              minHeight: 60,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
            }}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Body strong numberOfLines={1}>
                {active.name}
              </Body>
              <Small numberOfLines={1}>
                {active.kind === 'business' ? 'Business' : 'Personal'} · {active.memberCount}{' '}
                {memberWord} · {active.role}
              </Small>
            </View>
            {workspaces.length > 1 ? (
              <Button label="Switch" tone="outline" size="sm" onPress={() => setSwitching(true)} />
            ) : null}
          </View>
        </Section>

        {/* Preferences */}
        <Section label="Preferences">
          {/* Row pads its own 16pt sides; pull it out to the screen edge so its
              icon lines up with the section label above it. */}
          <View style={{ marginHorizontal: -space.lg }}>
            <Row icon="chart" title="Analytics" onPress={() => router.push('/analytics')} />
            <Row
              icon="users"
              title="People"
              trailing={<Small>{`${active.memberCount} ${memberWord}`}</Small>}
              onPress={() => router.push('/members')}
            />
            <Row icon="cog" title="Settings" onPress={() => router.push('/settings')} />
          </View>
        </Section>
      </ScrollView>

      <WorkspacePicker open={switching} onClose={() => setSwitching(false)} />
    </Screen>
  );
}

/** One dial in the balances readout — the same one Home draws. */
function Readout({
  label,
  value,
  unit,
  onPress,
  inset,
}: {
  label: string;
  value: string;
  unit: string;
  onPress: () => void;
  inset?: boolean;
}) {
  const p = usePalette();
  return (
    <PressableScale
      accessibilityLabel={`${label}: ${value}. Show how they were used.`}
      onPress={onPress}
      containerStyle={{ flex: 1 }}
      style={{ paddingLeft: inset ? space.lg : 0, gap: 6 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.label, { color: p.inkMuted }]}>{label}</Text>
        <Icon name="chevronRight" size={14} color={p.inkFaint} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text style={[type.h1, { fontWeight: '300', letterSpacing: -0.8 }, numeric, { color: p.ink }]}>
          {value}
        </Text>
        <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={1}>
          {unit}
        </Text>
      </View>
    </PressableScale>
  );
}
