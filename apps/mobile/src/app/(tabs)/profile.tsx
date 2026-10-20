import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import type { YourtalLinkStatus } from '@snap/api-contract';
import { LinearGradient } from 'expo-linear-gradient';

import { Icon, type IconName } from '@/components/Icon';
import { Body, Card, Divider, Screen, SectionHeader, Small } from '@/components/ui';
import { pointsSummary } from '@/lib/yourtal-link';
import { useSession } from '@/session';
import { WorkspacePicker, useWorkspace } from '@/workspace';
import { heroGradient, numeric, radius, shadow, space, type, usePalette, useTheme } from '@/theme';

/**
 * Profile — new in the 2026-09-19 redesign, and now a tab rather than a row
 * buried in the menu.
 *
 * The screen answers three questions in the order people ask them: who am I
 * signed in as, what have I got left, and whose books am I looking at. The two
 * balances sit on the brand gradient because they are the only numbers here,
 * and both are tappable: a balance nobody can explain is a support ticket, so
 * credits lead to the usage that produced them and YourTal points lead to the
 * link. The points tile is YourTal's, not a Snap Apps balance (D33), and is
 * absent when the server has the link off.
 */
export default function ProfileScreen() {
  const p = usePalette();
  const { scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { active, workspaces } = useWorkspace();
  const [credits, setCredits] = useState<number | null>(null);
  const [yourtal, setYourtal] = useState<YourtalLinkStatus | null>(null);
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
        .getYourtalLink()
        .then((s) => live && setYourtal(s))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, []),
  );

  const user = session?.user;
  const points = pointsSummary(yourtal);
  const memberWord = active.memberCount === 1 ? 'person' : 'people';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        {/* Identity */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: p.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.h2, { color: p.accentText }]}>{user?.initials ?? '—'}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[type.h2, { color: p.ink }]} numberOfLines={1}>
              {user?.displayName ?? 'Signed out'}
            </Text>
            <Text style={[type.body, { color: p.inkMuted }]} numberOfLines={1}>
              {user?.email ?? ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/settings')}
            hitSlop={8}
            style={({ pressed }) => ({
              minHeight: 36,
              paddingHorizontal: space.lg,
              borderWidth: 1.5,
              borderColor: p.ruleStrong,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[type.smallStrong, { color: p.accentText }]}>Edit</Text>
          </Pressable>
        </View>

        {/* Balances: one lifted gradient card with two halves, each a left
            aligned figure. Built here rather than with GradientHero, whose
            22pt padding would put a gutter round the halves; each half pads
            itself so its whole area is the tap target. The halves are told
            apart by a short, faint inset rule, not a full-height divider.
            A PLAIN gradient — no decorative circles, whose edges cut across
            the halves instead of reading as soft light.
            Everything on it reads in white: the prototype notes that muted
            tints failed contrast here, so none are used. */}
        <View style={{ gap: space.md }}>
          <View style={[{ borderRadius: radius.xxl }, scheme === 'light' ? shadow.lift : null]}>
            <LinearGradient
              colors={[...heroGradient.colors]}
              locations={[...heroGradient.locations]}
              start={heroGradient.start}
              end={heroGradient.end}
              style={{
                borderRadius: radius.xxl,
                overflow: 'hidden',
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: 'rgba(255,255,255,0.14)',
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                <BalanceTile
                  icon="wallet"
                  label="Credits"
                  value={credits === null ? '—' : String(credits)}
                  onPress={() => router.push({ pathname: '/usage', params: { kind: 'credits' } })}
                />
                {points ? (
                  <>
                    <View style={{ justifyContent: 'center' }}>
                      <View style={{ width: 1, height: 48, backgroundColor: 'rgba(255,255,255,0.18)' }} />
                    </View>
                    <BalanceTile
                      icon="spark"
                      label="YourTal points"
                      value={points.value}
                      hint="Open YourTal points."
                      onPress={() => router.push('/points')}
                    />
                  </>
                ) : null}
              </View>
            </LinearGradient>
          </View>
          <Small>
            {points
              ? 'Tap Credits to see how they were used. YourTal points are paid in YourTal.'
              : 'Tap Credits to see how they were used.'}
          </Small>
        </View>

        {/* Active space */}
        <View style={{ gap: space.md }}>
          <SectionHeader title="Workspace" />
          <Card padded={false}>
            <View
              style={{
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: radius.md,
                  backgroundColor: p.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="users" size={22} color={p.inkStrong} />
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
                  hitSlop={8}
                  style={({ pressed }) => ({
                    minHeight: 36,
                    paddingHorizontal: space.lg,
                    borderWidth: 1.5,
                    borderColor: p.ruleStrong,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={[type.smallStrong, { color: p.ink }]}>Switch</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        </View>

        {/* Preferences: one white lifted card, hairlines inset past the icon
            tile so they divide the labels rather than the whole row. */}
        <View style={{ gap: space.md }}>
          <SectionHeader title="Preferences" />
          <Card padded={false}>
            <PrefRow icon="chart" label="Analytics" onPress={() => router.push('/analytics')} />
            <Divider style={{ marginLeft: space.lg + 40 + space.md }} />
            <PrefRow
              icon="users"
              label="People"
              value={`${active.memberCount} ${memberWord}`}
              onPress={() => router.push('/members')}
            />
            <Divider style={{ marginLeft: space.lg + 40 + space.md }} />
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
  hint = 'Show how they were used.',
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. ${hint}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        gap: space.sm,
        padding: space.lg,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.sm + 2,
          backgroundColor: 'rgba(255,255,255,0.18)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={18} color="#FFFFFF" />
      </View>
      <Text style={[type.h1, numeric, { color: '#FFFFFF' }]} numberOfLines={1}>
        {value}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <Text style={[type.smallStrong, { color: 'rgba(255,255,255,0.95)' }]}>{label}</Text>
        <Icon name="chevronRight" size={14} color="rgba(255,255,255,0.95)" />
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
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radius.md,
          backgroundColor: p.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={22} color={p.inkStrong} />
      </View>
      <Text style={[type.bodyStrong, { flex: 1, color: p.ink }]}>{label}</Text>
      {value ? <Text style={[type.small, { color: p.inkMuted }]}>{value}</Text> : null}
      <Icon name="chevronRight" size={18} color={p.inkFaint} />
    </Pressable>
  );
}
