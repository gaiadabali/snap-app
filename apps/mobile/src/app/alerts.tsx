import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AlertItem } from '@/api';
import { Icon } from '@/components/Icon';
import { Body, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { formatShortDate, numeric, space, type, usePalette } from '@/theme';

/**
 * The alert feed.
 *
 * Grouped by recency rather than kind, because these are events and "what
 * happened while I was away" is the question. Unread rows carry a small accent
 * square (accent, not red — red means money at risk, and a notification is not
 * that); everything is marked read on the way out rather than per row, since
 * scrolling past something is reading it.
 *
 * Rows are a ledger: the date in a mono gutter, so the list reads down the
 * left edge for "when". The per-kind icon the prototype drew in a tinted disc
 * is gone — the title already says what kind of thing it is.
 */

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
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Notifications" onBack={() => router.back()} />

        {alerts !== null && alerts.length === 0 ? (
          <View style={{ gap: space.xs, paddingVertical: space.xl }}>
            <Body strong>Nothing to report</Body>
            <Small>Budget warnings and receipts needing a look will appear here.</Small>
          </View>
        ) : null}

        {groups.map(([title, items]) => (
          <Section key={title} label={title}>
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
                    gap: space.md,
                    paddingVertical: 14,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                    backgroundColor: pressed ? p.surface : 'transparent',
                  })}
                >
                  <Text
                    style={[
                      type.mono,
                      numeric,
                      { width: 50, paddingTop: 2, color: p.inkMuted, letterSpacing: 0.4 },
                    ]}
                  >
                    {formatShortDate(a.createdAt.slice(0, 10)).toUpperCase()}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text style={[type.bodyStrong, { flex: 1, color: p.ink }]} numberOfLines={1}>
                        {a.title}
                      </Text>
                      {unread ? (
                        <View
                          style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: p.accent }}
                        />
                      ) : null}
                    </View>
                    <Small>{a.body}</Small>
                    <Small style={{ color: p.inkFaint }}>{ago(a.createdAt)}</Small>
                  </View>
                  {a.href ? (
                    <View style={{ paddingTop: 3 }}>
                      <Icon name="chevronRight" size={16} color={p.inkFaint} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </Section>
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
