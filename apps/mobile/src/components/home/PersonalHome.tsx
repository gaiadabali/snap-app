import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type DocumentView, type PersonalSummary } from '@/api';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { CategorySwatch, GradientHero, HeroBody, HeroFigure, HeroLabel, categoryHue } from '@/components/rich';
import { Chip, LedgerRow, ProgressBar, Section, Small } from '@/components/ui';
import { UpdateNotice } from '@/components/UpdateNotice';
import { Avatar } from '@/components/form';
import { useSession } from '@/session';
import { control, formatAud, numeric, onVoid, space, type, usePalette, useTheme } from '@/theme';
import { Text } from '@/theme/text';

import { Keypad, LatestReceipts, greeting } from './shared';

/**
 * Personal home: is this month going to hold?
 *
 * Everything tax is gone — no ABN, no GST, no tax invoice, no BAS — because
 * none of it applies to a household and all of it made the business screen
 * feel like accounting software. What replaces it is the one number a personal
 * tracker exists to produce: what is safe to spend today.
 *
 * The pace line in the panel is the honest version of that. Comparing a
 * part-month against a whole previous month is how most trackers flatter or
 * frighten their users; this one compares against the same day last month.
 *
 * Rebuilt again 2026-10-19 (the instrument pass). The order is the same as
 * the prototype's — who you are, what is left, what scanning costs, where to
 * go, where it went, what came in — but no two consecutive blocks share a
 * shape any more: a chrome row, the one dark panel, a two-dial readout, a
 * keypad strip, a split bar over a ledger, a dated ledger. The prototype ran
 * five rounded cards in a column, which is the metronome DESIGN-HANDOFF.md
 * §12.1 names as the tell.
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
  const daysInMonth = summary ? summary.daysElapsed + summary.daysLeftInMonth - 1 : 0;
  // A comparison, not arithmetic on money: which side of last month's pace.
  const aheadOfLastMonth = summary
    ? Number(summary.spentThisMonth) > Number(summary.lastMonthToDate)
    : false;
  const lowCredits = credits !== null && credits <= 5;

  return (
    <View style={{ flex: 1, backgroundColor: p.ground }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.xxl,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.inkMuted} />
        }
      >
        {/* Chrome — who you are, the theme, whether anything is waiting. */}
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
              gap: 12,
              minHeight: control.tap,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Avatar initials={session?.user.initials ?? '—'} size={38} />
            <View style={{ minWidth: 0, flex: 1, gap: 1 }}>
              <Text style={[type.small, { color: p.inkMuted }]}>{greeting()}</Text>
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
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Icon name={scheme === 'dark' ? 'sun' : 'moon'} size={20} color={p.inkStrong} />
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
              marginRight: -10,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            <Icon name="bell" size={20} color={p.inkStrong} />
            {unread > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 11,
                  width: 7,
                  height: 7,
                  borderRadius: 2,
                  backgroundColor: p.accent,
                  borderWidth: 1.5,
                  borderColor: p.ground,
                }}
              />
            ) : null}
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
          {/* Renders nothing unless a newer build is actually published. */}
          <UpdateNotice />
        </View>

        {/* The panel. What is LEFT, not what is spent: a tracker that leads
            with the total spent tells you about the past; this one is about
            the rest of the month. It is the only dark thing on the screen. */}
        <View style={{ paddingHorizontal: space.lg, marginTop: space.md }}>
          <GradientHero tone={over ? 'risk' : 'brand'}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
              <HeroLabel>
                {over ? 'Over budget' : 'Left to spend'} · {summary?.monthLabel ?? '—'}
              </HeroLabel>
              {summary ? (
                <Text style={[type.label, numeric, { color: p.voidMuted }]}>
                  {summary.daysLeftInMonth} day{summary.daysLeftInMonth === 1 ? '' : 's'} left
                </Text>
              ) : null}
            </View>

            <View style={{ marginTop: 14, minHeight: 56 }}>
              {summary ? (
                <HeroFigure settle>
                  {formatAud(over ? `-${summary.remaining.replace('-', '')}` : summary.remaining)}
                </HeroFigure>
              ) : null}
            </View>

            <View style={{ marginTop: 2 }}>
              <HeroBody>
                {summary
                  ? over
                    ? `${formatAud(summary.spentThisMonth)} spent against ${formatAud(summary.budgetTotal, { cents: false })}`
                    : `${formatAud(summary.safeToSpendPerDay)} a day for the rest of the month`
                  : ' '}
              </HeroBody>
            </View>

            {/* Budget used against month elapsed. The tick is where an even
                spend would put you today — the gap between the fill and the
                tick is the whole message. */}
            <View style={{ marginTop: 22, gap: 8 }}>
              <ProgressBar
                value={budgetUsed}
                marker={monthElapsed}
                height={3}
                track={onVoid.track}
                tone={over ? onVoid.risk : p.voidInk}
                markerColor={onVoid.accent}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.label, numeric, { color: p.voidMuted }]}>
                  Spent {Math.round(budgetUsed * 100)}%
                </Text>
                <Text style={[type.label, numeric, { color: onVoid.accent }]}>
                  Day {summary?.daysElapsed ?? '—'}/{daysInMonth || '—'}
                </Text>
              </View>
            </View>

            {/* The pace readout, and the way out to the detail. */}
            <View
              style={{
                marginTop: 18,
                marginHorizontal: -20,
                marginBottom: -20,
                borderTopWidth: 1,
                borderTopColor: p.voidRule,
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 20, gap: 3 }}>
                <Text style={[type.label, { color: p.voidMuted }]}>Last month, by today</Text>
                <Text style={[type.amount, numeric, { color: p.voidInk }]}>
                  {summary ? formatAud(summary.lastMonthToDate) : '—'}
                  {summary ? (
                    <Text style={{ color: aheadOfLastMonth ? onVoid.warn : onVoid.good }}>
                      {aheadOfLastMonth ? '  ▲ faster' : '  ▼ slower'}
                    </Text>
                  ) : null}
                </Text>
              </View>
              <PressableScale
                accessibilityLabel="Budgets"
                onPress={() => router.push('/budgets')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 56,
                  paddingHorizontal: 20,
                  borderLeftWidth: 1,
                  borderLeftColor: p.voidRule,
                }}
              >
                <Text style={[type.smallStrong, { color: p.voidInk }]}>Budgets</Text>
                <Icon name="chevronRight" size={15} color={p.voidInk} />
              </PressableScale>
            </View>
          </GradientHero>
        </View>

        {/* What scanning costs, and what it earns — two dials, one rule
            between them. Credits lead because running out is the one thing
            that stops the app working. */}
        <View
          style={{
            flexDirection: 'row',
            marginHorizontal: space.lg,
            marginTop: space.xl,
          }}
        >
          <Readout
            label="Credits"
            value={credits === null ? '—' : String(credits)}
            unit={credits === 1 ? 'scan left' : 'scans left'}
            tone={lowCredits ? 'warn' : 'ink'}
            onPress={() => router.push('/credits')}
          />
          <View style={{ width: 1, backgroundColor: p.rule, marginVertical: 4 }} />
          {/* NOT derived from the document count. Points are awarded per
              capture by the server and the two numbers legitimately disagree
              — a document imported from a statement earns none. Showing
              "from N scans" next to a smaller balance reads as a bug in the
              app rather than a fact about the ledger. */}
          <Readout
            label="Points"
            value={points === null ? '—' : points.toLocaleString('en-AU')}
            unit="for scan credits"
            onPress={() => router.push('/points')}
            inset
          />
        </View>

        <View style={{ paddingHorizontal: space.lg, marginTop: space.xl }}>
          <Keypad
            keys={[
              { icon: 'receipt', label: 'Spending', href: '/receipts' },
              { icon: 'chart', label: 'Analytics', href: '/analytics' },
              { icon: 'repeat', label: 'Recurring', href: '/recurring' },
              { icon: 'bank', label: 'Goals', href: '/goals' },
            ]}
          />
        </View>

        {/* The shape of the month. Budgets answers "am I over?"; this answers
            "where did it actually go?" — one bar drawn in proportion, then
            the same shares as a ledger a reader can check it against. */}
        <Section
          label="Where it went"
          action={{ label: 'Analytics', onPress: () => router.push('/analytics') }}
          style={{ paddingHorizontal: space.lg, marginTop: space.xxl }}
          rule={false}
        >
          {summary && summary.byCategory.some((c) => Number(c.spent) > 0) ? (
            <CategorySplit summary={summary} />
          ) : (
            <View style={{ paddingVertical: space.lg, borderTopWidth: 1, borderTopColor: p.rule }}>
              <Small>{summary ? 'Nothing spent yet this month.' : 'Loading…'}</Small>
            </View>
          )}
        </Section>

        <View style={{ marginTop: space.xxl }}>
          <LatestReceipts docs={docs.slice(0, 4)} />
        </View>

        {summary ? (
          <Text
            style={[
              type.label,
              { color: p.inkFaint, textAlign: 'center', marginTop: space.xl },
            ]}
          >
            {summary.receiptCount} receipt{summary.receiptCount === 1 ? '' : 's'} in {summary.monthLabel}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** One dial in the balances readout. */
function Readout({
  label,
  value,
  unit,
  tone = 'ink',
  onPress,
  inset,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: 'ink' | 'warn';
  onPress: () => void;
  inset?: boolean;
}) {
  const p = usePalette();
  return (
    <PressableScale
      accessibilityLabel={`${label}: ${value} ${unit}`}
      onPress={onPress}
      containerStyle={{ flex: 1 }}
      style={{ paddingLeft: inset ? space.lg : 0, gap: 6 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.label, { color: tone === 'warn' ? p.warn : p.inkMuted }]}>{label}</Text>
        <Icon name="chevronRight" size={14} color={p.inkFaint} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text
          style={[
            type.h1,
            { fontWeight: '300', letterSpacing: -0.8 },
            numeric,
            { color: tone === 'warn' ? p.warn : p.ink },
          ]}
        >
          {value}
        </Text>
        <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={1}>
          {unit}
        </Text>
      </View>
    </PressableScale>
  );
}

/** The month's categories: a proportional bar, then a ledger of the same shares. */
function CategorySplit({ summary }: { summary: PersonalSummary }) {
  const p = usePalette();
  const parts = summary.byCategory.filter((c) => Number(c.spent) > 0);
  const total = parts.reduce((a, c) => a + Number(c.spent), 0) || 1;
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          height: 8,
          gap: 2,
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: space.sm,
        }}
      >
        {parts.map((c) => (
          <View
            key={c.category}
            style={{ flex: Math.max(Number(c.spent) / total, 0.015), backgroundColor: categoryHue(c.category) }}
          />
        ))}
      </View>
      {parts.slice(0, 5).map((c, i) => (
        <LedgerRow
          key={c.category}
          first={i === 0}
          lead={<CategorySwatch category={c.category} size={10} />}
          title={c.category}
          note={
            c.budget
              ? `of ${formatAud(c.budget, { cents: false })}${c.used !== null && c.used > 1 ? ' — over' : ''}`
              : undefined
          }
          figure={formatAud(c.spent)}
          figureTone={c.used !== null && c.used > 1 ? 'risk' : 'ink'}
          trailing={
            <Text style={[type.mono, numeric, { color: p.inkFaint, width: 36, textAlign: 'right' }]}>
              {Math.round((Number(c.spent) / total) * 100)}%
            </Text>
          }
        />
      ))}
    </View>
  );
}
