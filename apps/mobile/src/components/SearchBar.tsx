import { Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';

import { Chip } from '@/components/ui';
import { radius, space, usePalette } from '@/theme';

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
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: p.surfaceAlt,
        borderRadius: radius.pill,
        paddingHorizontal: space.md,
      }}
    >
      <Icon name="search" size={18} color={p.inkFaint} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, paddingVertical: 10, color: p.ink, fontSize: 15 }}
        accessibilityLabel="Search"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={10}
          onPress={() => onChangeText('')}
        >
          <Text style={{ fontSize: 17, color: p.inkFaint }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PeriodChips({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {PERIODS.map((x) => (
        <Chip key={x.key} selected={value === x.key} onPress={() => onChange(x.key)}>
          {x.label}
        </Chip>
      ))}
    </View>
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
