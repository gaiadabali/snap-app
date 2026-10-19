import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { Icon } from '@/components/Icon';

import { space, type, usePalette } from '@/theme';

/**
 * Search and period, over a list that is now nearly a thousand rows long.
 *
 * Both are needed together: "Bunnings" across a year returns dozens of rows,
 * and "March" alone returns a hundred. The period chips are quarters and
 * months rather than a date picker because the questions people actually ask
 * of a receipt list are "this quarter" (for the BAS) and "last month" (for a
 * reimbursement), not "between the 3rd and the 19th".
 */

export type Period = 'all' | 'month' | 'lastMonth' | 'quarter' | 'year';

export const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: '12 months' },
  { key: 'all', label: 'All' },
];

/** Inclusive [from, to] for a period, as ISO dates. */
export function periodRange(period: Period, now = new Date()): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const end = iso(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  switch (period) {
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: end };
    case 'lastMonth':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'quarter':
      return {
        from: iso(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)),
        to: end,
      };
    case 'year':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: end };
    default:
      return { from: '0000-01-01', to: '9999-12-31' };
  }
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search merchant, category or amount',
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}) {
  const p = usePalette();
  // A recessed field (`surface`, not a card): the edge-less fill says "type
  // here" the way the phone's own search fields do.
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        height: 46,
        backgroundColor: p.surface,
        borderRadius: 14,
        paddingHorizontal: space.md,
      }}
    >
      <Icon name="search" size={19} color={p.inkFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, paddingVertical: space.sm, color: p.ink, fontSize: 16 }}
        accessibilityLabel="Search"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          onPress={() => onChangeText('')}
        >
          <Text style={{ fontSize: 19, color: p.inkFaint }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One scrolling row that runs to the screen edges. The caller's side padding is
 * `space.gutter`; the negative margin cancels it so chips slide under the
 * bezel, and the content padding puts the first chip back on the gutter.
 */
export function PeriodChips({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const p = usePalette();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -space.gutter, flexGrow: 0 }}
      contentContainerStyle={{ paddingHorizontal: space.gutter, gap: space.sm }}
    >
      {PERIODS.map((x) => {
        const on = value === x.key;
        return (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            hitSlop={6}
            onPress={() => onChange(x.key)}
            style={{
              height: 36,
              paddingHorizontal: space.md,
              borderRadius: 18,
              justifyContent: 'center',
              backgroundColor: on ? p.accent : p.card,
              borderWidth: on ? 0 : StyleSheet.hairlineWidth * 2,
              borderColor: p.ruleStrong,
            }}
          >
            <Text style={[type.smallStrong, { color: on ? p.accentInk : p.inkStrong }]}>
              {x.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Does a document match a free-text query?
 *
 * Matches the merchant, the category, the note and the line descriptions, plus
 * the amount as typed — "18.50" should find the docket whose total that is,
 * because that is how someone searches for a receipt they half-remember.
 */
export function matchesQuery(
  d: {
    supplierName: string;
    category: string;
    note: string | null;
    payableAmount: string;
    lines: Array<{ description: string }>;
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (d.supplierName.toLowerCase().includes(q)) return true;
  if (d.category.toLowerCase().includes(q)) return true;
  if ((d.note ?? '').toLowerCase().includes(q)) return true;
  if (d.lines.some((l) => l.description.toLowerCase().includes(q))) return true;
  // Amounts: match the printed form, so "18.5" and "18.50" both work.
  const amount = Number(d.payableAmount).toFixed(2);
  return amount.startsWith(q.replace(/[$,]/g, ''));
}
