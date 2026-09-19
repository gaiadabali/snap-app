import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type NotificationPrefs } from '@/api';
import { Toggle } from '@/components/form';
import { Body, Card, Notice, Screen, ScreenHeader, Small } from '@/components/ui';
import { radius, space, type, usePalette } from '@/theme';

/**
 * What the app is allowed to interrupt you for.
 *
 * Every switch writes immediately rather than collecting into a Save button:
 * there is nothing here that only makes sense as a set, and a preferences
 * screen with a Save button is a preferences screen people leave half-applied.
 *
 * The optimistic update is intentional — the toggle moves at once and rolls
 * back only if the write fails. A switch that waits for a round trip feels
 * broken on a train.
 */
const ROWS: Array<{ key: keyof NotificationPrefs; label: string; hint: string }> = [
  {
    key: 'budgetTight',
    label: 'A budget is getting tight',
    hint: 'When a category passes about 80% of its monthly allowance.',
  },
  {
    key: 'reviewNeeded',
    label: 'A receipt needs checking',
    hint: 'When something was read with low confidence and wants a human eye.',
  },
  {
    key: 'lowCredits',
    label: 'Credits running out',
    hint: 'Before scanning stops working, not after.',
  },
  {
    key: 'recurringDue',
    label: 'A recurring charge is due',
    hint: 'Subscriptions and standing bills you have told us about.',
  },
  {
    key: 'productNews',
    label: 'Product news',
    hint: 'Occasional, and off unless you turn it on.',
  },
];

export default function NotificationsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .getNotificationPrefs()
        .then((x) => live && setPrefs(x))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, []),
  );

  async function set(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setError(null);
    try {
      setPrefs(await api().updateNotificationPrefs({ [key]: value }));
    } catch (e) {
      setPrefs(before);
      setError(e instanceof Error ? e.message : 'That did not save.');
    }
  }

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

        <View style={{ backgroundColor: p.accentSoft, borderRadius: radius.lg, padding: space.lg, gap: 6 }}>
          <Body strong>Facts about your own money, and nothing else</Body>
          <Text style={[type.small, { color: p.inkStrong }]}>
            We will never send a marketing push. Every switch below is an event in your own
            records.
          </Text>
        </View>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Card padded={false}>
          {ROWS.map((r, i) => (
            <View
              key={r.key}
              style={{
                paddingHorizontal: space.lg,
                paddingVertical: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: p.rule,
              }}
            >
              <Toggle
                label={r.label}
                hint={r.hint}
                value={prefs?.[r.key] ?? false}
                onChange={(v) => void set(r.key, v)}
              />
            </View>
          ))}
        </Card>

        <Small style={{ textAlign: 'center' }}>
          Your phone will ask for permission the first time one of these is due, not before.
        </Small>
      </ScrollView>
    </Screen>
  );
}
