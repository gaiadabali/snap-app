import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon, type IconName } from '@/components/Icon';
import { Body, Card, Divider, Screen, Small } from '@/components/ui';
import { useSession } from '@/session';
import { WorkspacePicker, useWorkspace } from '@/workspace';
import { heroGradient, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Profile — new in the 2026-09-19 redesign, and now a tab rather than a row
 * buried in the menu.
 *
 * The screen answers three questions in the order people ask them: who am I
 * signed in as, what have I got left, and whose books am I looking at. The two
 * balances sit on the brand gradient because they are the only numbers here,
 * and both are tappable: a balance nobody can explain is a support ticket, so
 * each one leads to the ledger that produced it.
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
      // tile, which is the one that governs whether scanning still works.
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
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 15,
        }}
      >
        {/* Identity */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 34,
              backgroundColor: p.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 23, lineHeight: 29, fontWeight: '700', color: p.accentText }}>
              {user?.initials ?? '—'}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={{ fontSize: 21, lineHeight: 27, fontWeight: '700', color: p.ink }} numberOfLines={1}>
              {user?.displayName ?? 'Signed out'}
            </Text>
            <Text style={[type.small, { color: p.inkMuted, fontSize: 14, lineHeight: 20 }]} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            style={({ pressed }) => ({
              minHeight: 40,
              paddingHorizontal: space.lg,
              borderWidth: 1.5,
              borderColor: p.ruleStrong,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[type.smallStrong, { color: p.accentText, fontSize: 14, lineHeight: 20 }]}>
              Edit
            </Text>
          </Pressable>
        </View>

        {/* Balances. A PLAIN gradient — unlike the hero cards this strip has
            no decorative circles, because at 90pt tall their edges cut visibly
            across the tiles instead of reading as soft light.
            Everything on it reads in white: the prototype notes that muted
            tints failed contrast here, so none are used. */}
        <LinearGradient
          colors={[...heroGradient.colors]}
          locations={[...heroGradient.locations]}
          start={heroGradient.start}
          end={heroGradient.end}
          style={{ borderRadius: 16, overflow: 'hidden' }}
        >
          <View style={{ flexDirection: 'row' }}>
            <BalanceTile
              icon="wallet"
              label="Credits"
              value={credits === null ? '—' : String(credits)}
              onPress={() => router.push({ pathname: '/usage', params: { kind: 'credits' } })}
            />
            <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.22)' }} />
            <BalanceTile
              icon="spark"
              label="Points"
              value={points === null ? '—' : points.toLocaleString('en-AU')}
              onPress={() => router.push({ pathname: '/usage', params: { kind: 'points' } })}
            />
          </View>
        </LinearGradient>
        <Small>
          Tap a tile to see how it was used: credits spent on scanning, points spent in yourtal.
        </Small>

        {/* Active space */}
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15 }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 11,
              backgroundColor: p.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="users" size={20} color={p.inkStrong} />
          </View>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setSwitching(true)}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: 14,
                borderWidth: 1.5,
                borderColor: p.ruleStrong,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={[type.smallStrong, { color: p.ink }]}>Switch</Text>
            </Pressable>
          ) : null}
        </Card>

        {/* Preferences */}
        <View style={{ gap: 9 }}>
          <Text style={[type.label, { color: p.inkMuted, marginTop: 2 }]}>Preferences</Text>
          <Card padded={false}>
            <PrefRow icon="chart" label="Analytics" onPress={() => router.push('/analytics')} />
            <Divider />
            <PrefRow
              icon="users"
              label="People"
              value={`${active.memberCount} ${memberWord}`}
              onPress={() => router.push('/members')}
            />
            <Divider />
            <PrefRow icon="cog" label="Settings" onPress={() => router.push('/settings')} />
          </Card>
        </View>
      </ScrollView>

      <WorkspacePicker open={switching} onClose={() => setSwitching(false)} />
    </Screen>
  );
}

function BalanceTile({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Show how they were used.`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        gap: 5,
        paddingVertical: 15,
        paddingHorizontal: space.sm,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={16} color="#FFFFFF" />
      </View>
      <Text style={[type.figure, numeric, { color: '#FFFFFF' }]}>{value}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Text style={[type.tab, { color: 'rgba(255,255,255,0.95)' }]}>{label}</Text>
        <Icon name="chevronRight" size={12} color="rgba(255,255,255,0.95)" />
      </View>
    </Pressable>
  );
}

function PrefRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingVertical: 10,
        paddingHorizontal: space.lg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          backgroundColor: p.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color={p.inkStrong} />
      </View>
      <Text style={[type.bodyStrong, { flex: 1, color: p.ink }]}>{label}</Text>
      {value ? <Text style={[type.small, { color: p.inkMuted }]}>{value}</Text> : null}
      <Icon name="chevronRight" size={18} color={p.inkMuted} />
    </Pressable>
  );
}
