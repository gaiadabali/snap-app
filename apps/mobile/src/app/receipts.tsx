import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type DocumentView } from '@/api';
import { CategoryBar, CategoryIcon } from '@/components/rich';
import { Body, Button, Chip, Figure, Label, Screen, ScreenHeader, Small } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { Empty } from '@/components/form';
import {
  PeriodChips,
  SearchBar,
  matchesQuery,
  periodRange,
  type Period,
} from '@/components/SearchBar';
import { exportDocumentsCsv, exportLinesCsv } from '@/lib/share';
import { formatAud, space, usePalette } from '@/theme';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

/**
 * Every receipt, newest first.
 *
 * This used to be the home screen. It was moved to its own page because home
 * was carrying the whole list plus a summary plus a floating shutter, which
 * left no room for the things a daily user opens the app to check. A list this
 * long is a destination, not a dashboard.
 *
 * `?filter=review` deep-links straight to the ones needing a check, which is
 * how home's attention card gets here.
 */

function dayLabel(iso: string): string {
  const today = new Date();
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((+new Date(today.toDateString()) - +new Date(d.toDateString())) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-AU', { weekday: 'long' });
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Sum decimal strings exactly — never parse money to a float. */
function sumMoney(values: string[]): string {
  const total = values.reduce((acc, v) => {
    const [w = '0', f = ''] = v.replace('-', '').split('.');
    return acc + BigInt(w) * 10_000n + BigInt((f + '0000').slice(0, 4));
  }, 0n);
  return `${total / 10_000n}.${(total % 10_000n).toString().padStart(4, '0')}`;
}

export default function ReceiptsScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const { workspace, isBusiness } = useWorkspace();
  const [docs, setDocs] = useState<DocumentView[] | null>(null);
  const [onlyReview, setOnlyReview] = useState(filter === 'review');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  // Defaults to the quarter: the list is a year deep now, and "everything" is
  // rarely the question being asked of it.
  const [period, setPeriod] = useState<Period>('quarter');

  const load = useCallback(async () => {
    setDocs(await api().listDocuments('all', workspace));
  }, [workspace]);

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

  const loaded = docs ?? [];

  /** Period first, then text: the cheap filter before the expensive one. */
  const all = useMemo(() => {
    const { from, to } = periodRange(period);
    return loaded.filter(
      (d) => d.issueDate >= from && d.issueDate <= to && matchesQuery(d, query),
    );
  }, [loaded, period, query]);

  const needsReview = all.filter((d) => d.reviewStatus === 'needs_review').length;
  const total = useMemo(() => sumMoney(all.map((d) => d.payableAmount)), [all]);

  /** Share of spend per category, for the breakdown bar. */
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of all) {
      // Display-only aggregation, so a float is acceptable here; every figure
      // that is stored or reported stays a decimal string.
      m.set(d.category, (m.get(d.category) ?? 0) + Number(d.payableAmount));
    }
    return [...m.entries()].map(([category, amount]) => ({ category, amount }));
  }, [all]);

  const sections = useMemo(() => {
    const list = onlyReview ? all.filter((d) => d.reviewStatus === 'needs_review') : all;
    const byDay = new Map<string, DocumentView[]>();
    for (const d of [...list].sort((a, b) => b.issueDate.localeCompare(a.issueDate))) {
      const k = d.issueDate;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(d);
    }
    return [...byDay.entries()].map(([iso, data]) => ({
      title: dayLabel(iso),
      total: sumMoney(data.map((x) => x.payableAmount)),
      data,
    }));
  }, [all, onlyReview]);

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(d) => d.id}
        stickySectionHeadersEnabled
        // A year of receipts is ~900 rows. Without these the list mounts every
        // one of them up front and the first scroll stutters on a mid-range
        // phone; `removeClippedSubviews` also drops offscreen views on Android.
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: space.xxl + insets.bottom }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={p.accent} />
        }
        ListHeaderComponent={
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.md }}>
            <ScreenHeader title="Spending" onBack={() => router.back()} />
            <WorkspaceSwitch />

            <SearchBar value={query} onChangeText={setQuery} />
            <PeriodChips value={period} onChange={setPeriod} />

            {/* Exports exactly what the filters above have selected — a button
                that silently exported everything would be a trap. */}
            {all.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Chip onPress={() => void exportDocumentsCsv(all, period)}>
                  Export {all.length} as CSV
                </Chip>
                <Chip onPress={() => void exportLinesCsv(all, period)}>Export line items</Chip>
              </View>
            ) : null}

            <View
              style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}
            >
              <Label>{all.length} receipts</Label>
              <Figure size="h2">{formatAud(total)}</Figure>
            </View>

            {byCategory.length > 1 ? <CategoryBar parts={byCategory} /> : null}

            {isBusiness && needsReview > 0 ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Chip tone={onlyReview ? 'accent' : 'warn'} onPress={() => setOnlyReview((v) => !v)}>
                  {onlyReview ? `Showing ${needsReview} to check` : `${needsReview} need a quick check`}
                </Chip>
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              backgroundColor: p.ground,
              paddingHorizontal: space.lg,
              paddingTop: space.lg,
              paddingBottom: space.sm,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Label>{section.title}</Label>
            <Small>{formatAud(section.total)}</Small>
          </View>
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: p.rule, marginLeft: 72 }} />
        )}
        ListEmptyComponent={
          docs === null ? null : (
            <View style={{ padding: space.lg, gap: space.md }}>
              {query ? (
                <>
                  <Empty
                    title="Nothing matches"
                    detail={`No receipt in this period matches “${query}”. Try a wider period, or a different spelling.`}
                  />
                  <Button label="Clear search" tone="outline" onPress={() => setQuery('')} />
                </>
              ) : loaded.length > 0 ? (
                <>
                  <Empty
                    title="Nothing in this period"
                    detail="No receipts fall inside these dates. Try a wider one."
                  />
                  <Button label="Show everything" tone="outline" onPress={() => setPeriod('all')} />
                </>
              ) : (
                <>
                  <Empty
                    title="Nothing scanned yet"
                    detail="Photograph your first receipt and it lands here, searchable, with the original attached."
                  />
                  <Button
                    label="Scan a receipt"
                    icon="camera"
                    onPress={() => router.push('/capture')}
                  />
                </>
              )}
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/document/${item.id}`)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.lg,
              paddingVertical: 14,
              backgroundColor: pressed ? p.surface : 'transparent',
            })}
          >
            <CategoryIcon category={item.category} />

            <View style={{ flex: 1, gap: 3 }}>
              <Body strong numberOfLines={1}>
                {item.supplierName}
              </Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Small numberOfLines={1} style={{ flexShrink: 1 }}>
                  {item.category}
                </Small>
                {isBusiness && item.reviewStatus === 'needs_review' ? (
                  <Chip tone="warn">Check</Chip>
                ) : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Figure size="h2">{formatAud(item.payableAmount)}</Figure>
              <Icon name="chevronRight" size={17} color={p.inkFaint} />
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}
