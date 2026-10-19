import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type UsageKind, type UsagePeriod } from '@/api';
import { Icon } from '@/components/Icon';
import { Empty } from '@/components/form';
import { Chip, Figure, LedgerRow, Notice, Screen, ScreenHeader, Segmented, Small } from '@/components/ui';
import { numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Where the credits or the points went, one month at a time.
 *
 * The bar chart is twelve months of the chosen year and the list under it is
 * the chosen month, itemised. The two are one control: tapping a bar changes
 * the month, which is why the bars are buttons rather than a drawing.
 *
 * `kind` arrives as a route param because Profile's two balance tiles both
 * land here and the tile you tapped is the question you asked.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function UsageScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();

  const [kind, setKind] = useState<UsageKind>(params.kind === 'points' ? 'points' : 'credits');
  const [months, setMonths] = useState<string[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState<string | null>(null);
  const [period, setPeriod] = useState<UsagePeriod | null>(null);
  const [byMonth, setByMonth] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);

  // Which months exist at all, and the newest one to open on.
  useEffect(() => {
    let live = true;
    void api()
      .listUsageMonths(kind)
      .then((list) => {
        if (!live) return;
        setMonths(list);
        const newest = list[0] ?? null;
        setMonth(newest);
        if (newest) setYear(Number(newest.slice(0, 4)));
      })
      .catch(() => live && setMonths([]));
    return () => {
      live = false;
    };
  }, [kind]);

  // The chosen month's detail.
  useEffect(() => {
    if (!month) {
      setPeriod(null);
      return undefined;
    }
    let live = true;
    void api()
      .getUsage(kind, month)
      .then((x) => live && setPeriod(x))
      .catch(() => live && setPeriod(null));
    return () => {
      live = false;
    };
  }, [kind, month]);

  /* Totals for every month of the shown year, for the bars. Fetched together
     and stored by key so flicking between months does not refetch the chart. */
  useEffect(() => {
    let live = true;
    const wanted = months.filter((m) => m.startsWith(String(year)));
    void Promise.all(
      wanted.map((m) => api().getUsage(kind, m).then((u) => [m, u.total] as const).catch(() => [m, 0] as const)),
    ).then((pairs) => {
      if (!live) return;
      setByMonth(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [kind, year, months]);

  const peak = useMemo(() => Math.max(1, ...Object.values(byMonth)), [byMonth]);
  const years = useMemo(
    () => [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => b - a),
    [months],
  );

  const unit = kind === 'credits' ? 'credits' : 'points';
  const title = kind === 'credits' ? 'Credit usage' : 'Point usage';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.lg,
        }}
      >
        <ScreenHeader title={title} onBack={() => router.back()} />

        {/* Credits / points */}
        <Segmented
          options={[
            { value: 'credits', label: 'Credits' },
            { value: 'points', label: 'Points' },
          ]}
          value={kind}
          onChange={setKind}
        />

        {/* Year picker */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose a year"
            onPress={() => setOpen((v) => !v)}
            style={{
              minHeight: 36,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: 14,
              borderWidth: 1,
              borderColor: p.ruleStrong,
              borderRadius: radius.md,
            }}
          >
            <Icon name="calendar" size={14} color={p.inkMuted} />
            <Text style={[type.smallStrong, numeric, { color: p.ink }]}>{year}</Text>
            <Icon name="chevronDown" size={14} color={p.inkMuted} />
          </Pressable>
        </View>

        {open ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {years.map((y) => (
              <Chip
                key={y}
                selected={y === year}
                onPress={() => {
                  setYear(y);
                  setOpen(false);
                }}
              >
                {String(y)}
              </Chip>
            ))}
          </View>
        ) : null}

        {/* Chart. Twelve bars, drawn straight on the ground; the chosen month
            is the one in the accent. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: 5,
            height: 152,
            borderBottomWidth: 1,
            borderBottomColor: p.rule,
          }}
        >
          {MONTHS.map((label, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}`;
            const total = byMonth[key] ?? 0;
            const has = months.includes(key);
            const on = month === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${year}: ${total} ${unit}`}
                disabled={!has}
                onPress={() => setMonth(key)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 7,
                  opacity: has ? 1 : 0.4,
                }}
              >
                <View
                  style={{
                    width: 16,
                    maxWidth: '100%',
                    // A month with usage always shows at least a nub, so
                    // "one credit" and "none" do not look identical.
                    height: total > 0 ? Math.max(8, (total / peak) * 118) : 4,
                    borderRadius: 2,
                    backgroundColor: on ? p.accent : total > 0 ? p.ruleStrong : p.rule,
                  }}
                />
                <Text style={[type.tab, { color: on ? p.ink : p.inkMuted }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* The chosen month */}
        {period ? (
          <View>
            <View style={{ gap: 4 }}>
              <Text style={[type.label, { color: p.inkMuted }]}>{pretty(period.month)}</Text>
              <Figure size="display">{period.total.toLocaleString('en-AU')}</Figure>
              <Text style={[type.mono, { color: p.inkMuted }]}>
                {period.items.length === 1 ? '1 entry' : `${period.items.length} entries`} · {unit}
              </Text>
            </View>

            <View style={{ marginTop: space.lg }}>
              {period.items.map((it, i) => (
                <LedgerRow
                  key={it.id}
                  first={i === 0}
                  title={it.label}
                  note={day(it.occurredAt)}
                  figure={it.amount.toLocaleString('en-AU')}
                />
              ))}
            </View>

            {period.items.length === 0 ? <Small>Nothing used in this month.</Small> : null}
          </View>
        ) : (
          <Empty
            title="Nothing here yet"
            detail={
              kind === 'credits'
                ? 'Credits show up here as you scan.'
                : 'Points show up here once you start spending them.'
            }
          />
        )}

        <Notice tone="info" icon="info">
          {kind === 'credits'
            ? 'One credit is one page. A two-page invoice costs two, and a failed scan costs nothing.'
            : 'Points are earned by scanning and can be traded for scan credits, or spent in yourtal.'}
        </Notice>
      </ScrollView>
    </Screen>
  );
}

function pretty(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
