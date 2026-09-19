import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type DocumentView, type PersonalSummary } from '@/api';
import { CategoryRing, RingLegend } from '@/components/charts';
import { Icon } from '@/components/Icon';
import { GradientHero, HeroBody, HeroLabel, Raised } from '@/components/rich';
import { Card, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { UpdateNotice } from '@/components/UpdateNotice';
import { useSession } from '@/session';
import { control, formatAud, numeric, radius, space, type, usePalette, useTheme } from '@/theme';

import { Action, LatestReceipts, greeting } from './shared';

/**
 * Personal home: is this month going to hold?
 *
 * Everything tax is gone — no ABN, no GST, no tax invoice, no BAS — because
 * none of it applies to a household and all of it made the business screen
 * feel like accounting software. What replaces it is the one number a personal
 * tracker exists to produce: what is safe to spend today.
 *
 * The pace line under the hero is the honest version of that. Comparing a
 * part-month against a whole previous month is how most trackers flatter or
 * frighten their users; this one compares against the same day last month.
 *
 * Rebuilt 2026-09-19. Three things the prototype added and why they earn room
 * above the fold:
 *   - the chrome row — who you are, the theme, and whether anything is waiting;
 *   - credits and points, because scanning STOPS when credits run out and
 *     there was previously nowhere on the main screen that said so;
 *   - a donut instead of bars for the category split, since the question there
 *     is "what is the shape of this month", which a ring answers faster.
 *     The per-category-against-budget bars still exist, on the Budgets tab,
 *     where the question is "am I over?" instead.
 */
export default function PersonalHome() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const { scheme, toggle } = useTheme();

  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [docs, setDocs] = useState<DocumentView[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [points, setPoints] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [s, d] = await Promise.all([
      api().getPersonal(),
      api().listDocuments('all', 'personal'),
    ]);
    setSummary(s);
    setDocs(d);

    /* The balances and the alert count are settled separately and never
       awaited by the caller: none of them is worth holding the whole screen
       for, and a points outage must not blank the month. */
    void api().getCreditBalance().then((b) => setCredits(b.creditsRemaining)).catch(() => {});
    void api().getPointBalance().then((b) => setPoints(b.balance)).catch(() => {});
    void api()
      .listAlerts()
      .then((a) => setUnread(a.filter((x) => x.readAt === null).length))
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const over = summary ? Number(summary.remaining) < 0 : false;
  const spent = Number(summary?.spentThisMonth ?? 0);
  const budgetUsed = summary ? spent / Math.max(Number(summary.budgetTotal), 1) : 0;
  // Where you should be by now if the month were spent evenly.
  const monthElapsed = summary
    ? summary.daysElapsed / (summary.daysElapsed + summary.daysLeftInMonth - 1)
    : 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl + insets.bottom,
          gap: 15,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.accent} />
        }
      >
        {/* Chrome */}
        <View
          style={{
            paddingHorizontal: space.lg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/profile')}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              minHeight: control.tap,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: p.accentSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={[type.smallStrong, { fontWeight: '700', color: p.accentText }]}>
                {session?.user.initials ?? '—'}
              </Text>
            </View>
            <View style={{ minWidth: 0, flex: 1 }}>
              <Text style={[type.tiny, { color: p.inkMuted }]}>{greeting()}</Text>
              <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
                {session?.user.displayName ?? 'Snap Apps'}
              </Text>
            </View>
          </Pressable>

          {IS_DEMO ? <Chip tone="warn">Demo</Chip> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={scheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onPress={toggle}
            style={({ pressed }) => ({
              width: control.tap,
              height: control.tap,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name={scheme === 'dark' ? 'sun' : 'moon'} size={21} color={p.inkStrong} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            onPress={() => router.push('/alerts')}
            style={({ pressed }) => ({
              width: control.tap,
              height: control.tap,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="bell" size={21} color={p.inkStrong} />
            {unread > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 9,
                  right: 9,
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: p.risk,
                  borderWidth: 1.5,
                  borderColor: p.ground,
                }}
              />
            ) : null}
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg }}>
          {/* Renders nothing unless a newer build is actually published. */}
          <UpdateNotice />
        </View>

        {/* The hero is what is LEFT, not what is spent. A tracker that leads
            with the total spent tells you about the past; this one is about
            the rest of the month. */}
        <View style={{ paddingHorizontal: space.lg }}>
          <GradientHero tone={over ? 'risk' : 'brand'}>
            <View style={{ gap: space.xs }}>
              <HeroLabel>
                {over ? 'Over budget this month' : `Left to spend in ${summary?.monthLabel ?? 'this month'}`}
              </HeroLabel>
              <Text style={[type.hero, numeric, { color: '#FFFFFF' }]}>
                {formatAud(over ? `-${summary?.remaining.replace('-', '')}` : summary?.remaining)}
              </Text>
              <HeroBody>
                {summary?.daysLeftInMonth ?? 0} day{summary?.daysLeftInMonth === 1 ? '' : 's'} left ·{' '}
                {formatAud(summary?.safeToSpendPerDay)} a day
              </HeroBody>

              {/* Budget used against month elapsed. The pale marker is where
                  an even spend would put you today — the gap between the two
                  is the whole message. */}
              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  marginTop: space.sm,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    position: 'absolute',
                    left: `${Math.min(100, monthElapsed * 100)}%`,
                    width: 2,
                    top: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255,255,255,0.95)',
                  }}
                />
                <View
                  style={{
                    width: `${Math.min(100, Math.max(2, budgetUsed * 100))}%`,
                    height: '100%',
                    backgroundColor: '#FFFFFF',
                    opacity: 0.85,
                    borderRadius: 4,
                  }}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/budgets')}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: control.tap,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={[type.bodyStrong, { color: '#FFFFFF' }]}>Details</Text>
                <Icon name="chevronRight" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </GradientHero>
        </View>

        {/* What scanning costs, and what it earns. Credits lead because
            running out is the one thing that stops the app working. */}
        <View style={{ paddingHorizontal: space.lg }}>
          <Card padded={false}>
            <BalanceRow
              icon="wallet"
              label="Credits left"
              value={credits === null ? '—' : `${credits} scan${credits === 1 ? '' : 's'}`}
              tone={credits !== null && credits <= 5 ? 'warn' : 'accent'}
              onPress={() => router.push('/credits')}
            />
            <Divider />
            <BalanceRow
              icon="spark"
              label="Points earned"
              value={points === null ? '—' : points.toLocaleString('en-AU')}
              /* NOT derived from the document count. Points are awarded per
                 capture by the server and the two numbers legitimately
                 disagree — a document imported from a statement earns none.
                 Showing "from N scans" next to a smaller balance reads as a
                 bug in the app rather than a fact about the ledger. */
              hint="Trade them for scan credits"
              onPress={() => router.push('/points')}
            />
          </Card>
        </View>

        <View style={{ flexDirection: 'row', paddingHorizontal: space.lg, gap: space.sm }}>
          <Action icon="receipt" label="Spending" href="/receipts" />
          <Action icon="chart" label="Analytics" href="/analytics" />
          <Action icon="target" label="Budgets" href="/budgets" />
          <Action icon="repeat" label="Recurring" href="/recurring" />
        </View>

        {/* The shape of the month. Budgets answers "am I over?"; this answers
            "where did it actually go?", which a ring reads faster than bars. */}
        <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
          <Label>Spending by category</Label>
          <Raised style={{ gap: space.lg }}>
            {summary && summary.byCategory.length > 0 ? (
              <>
                <CategoryRing
                  parts={summary.byCategory}
                  centreLabel={summary.monthLabel}
                  centreValue={formatAud(summary.spentThisMonth, { cents: false })}
                />
                <RingLegend parts={summary.byCategory} limit={6} />
              </>
            ) : summary ? (
              <View style={{ alignItems: 'center', gap: 6, paddingVertical: space.lg }}>
                <Icon name="chart" size={26} color={p.inkMuted} />
                <Small>Nothing in this range</Small>
              </View>
            ) : (
              <Small>Loading…</Small>
            )}
          </Raised>
        </View>

        <LatestReceipts docs={docs.slice(0, 3)} />

        {summary ? (
          <Small style={{ textAlign: 'center' }}>
            {summary.receiptCount} receipts in {summary.monthLabel}
          </Small>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function BalanceRow({
  icon,
  label,
  value,
  hint,
  tone = 'accent',
  onPress,
}: {
  icon: 'wallet' | 'spark';
  label: string;
  value: string;
  hint?: string;
  tone?: 'accent' | 'warn';
  onPress: () => void;
}) {
  const p = usePalette();
  const fg = tone === 'warn' ? p.warn : p.accentText;
  const bg = tone === 'warn' ? p.warnSoft : p.accentSoft;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 62,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: space.lg,
        paddingVertical: 11,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm + 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={19} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text style={[type.bodyStrong, { color: p.ink }]}>{label}</Text>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      <Figure size="body" tone={tone === 'warn' ? 'risk' : 'ink'} style={{ fontWeight: '700' }}>
        {value}
      </Figure>
      <Icon name="chevronRight" size={17} color={p.inkFaint} />
    </Pressable>
  );
}
