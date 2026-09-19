import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AlertItem, type AlertKind } from '@/api';
import { Icon, type IconName } from '@/components/Icon';
import { Body, Card, Screen, ScreenHeader, Small } from '@/components/ui';
import { space, type, usePalette } from '@/theme';

/**
 * The alert feed.
 *
 * Grouped by recency rather than kind, because these are events and "what
 * happened while I was away" is the question. Unread rows carry a dot and a
 * tinted ground; everything is marked read on the way out rather than per row,
 * since scrolling past something is reading it.
 */
const ICONS: Record<AlertKind, IconName> = {
  budget: 'target',
  review: 'search',
  credits: 'wallet',
  recurring: 'repeat',
  system: 'info',
};

export default function AlertsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .listAlerts()
        .then((x) => live && setAlerts(x))
        .catch(() => live && setAlerts([]));

      // Marked read on the way OUT, so the unread styling survives the visit
      // that is reading it. Fire-and-forget: a failed mark is a cosmetic
      // problem next launch, not something worth blocking navigation on.
      return () => {
        live = false;
        void api().markAlertsRead().catch(() => {});
      };
    }, []),
  );

  const groups = groupByAge(alerts ?? []);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
      >
        <ScreenHeader title="Notifications" onBack={() => router.back()} />

        {alerts !== null && alerts.length === 0 ? (
          <Card style={{ alignItems: 'center', gap: space.sm, paddingVertical: 34 }}>
            <Icon name="bell" size={28} color={p.inkMuted} />
            <Body strong>Nothing to report</Body>
            <Small style={{ textAlign: 'center' }}>
              Budget warnings and receipts needing a look will appear here.
            </Small>
          </Card>
        ) : null}

        {groups.map(([title, items]) => (
          <View key={title} style={{ gap: space.sm }}>
            <Text style={[type.label, { color: p.inkMuted }]}>{title}</Text>
            <Card padded={false}>
              {items.map((a, i) => {
                const unread = a.readAt === null;
                return (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${unread ? 'Unread. ' : ''}${a.title}. ${a.body}`}
                    disabled={!a.href}
                    onPress={() => a.href && router.push(a.href as never)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: 13,
                      paddingHorizontal: space.lg,
                      paddingVertical: 14,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                      backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                    })}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: unread ? p.accentSoft : p.surfaceAlt,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon
                        name={ICONS[a.kind]}
                        size={18}
                        color={unread ? p.accentText : p.inkMuted}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <Text style={[type.bodyStrong, { flex: 1, color: p.ink }]} numberOfLines={1}>
                          {a.title}
                        </Text>
                        {unread ? (
                          <View
                            style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }}
                          />
                        ) : null}
                      </View>
                      <Small>{a.body}</Small>
                      <Small style={{ color: p.inkFaint }}>{ago(a.createdAt)}</Small>
                    </View>
                    {a.href ? <Icon name="chevronRight" size={17} color={p.inkFaint} /> : null}
                  </Pressable>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

function groupByAge(list: AlertItem[]): Array<[string, AlertItem[]]> {
  const now = Date.now();
  const buckets: Record<string, AlertItem[]> = { Today: [], 'This week': [], Earlier: [] };
  for (const a of [...list].sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
    const age = now - new Date(a.createdAt).getTime();
    const key = age < 864e5 ? 'Today' : age < 6048e5 ? 'This week' : 'Earlier';
    buckets[key].push(a);
  }
  return Object.entries(buckets).filter(([, v]) => v.length > 0);
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
