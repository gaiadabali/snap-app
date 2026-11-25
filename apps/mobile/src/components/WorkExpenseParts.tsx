import { Pressable, View } from 'react-native';
import { pickerGroups, taxCategoryHint, type workExpenseStatus } from '@snap/api-contract/work-expense';

import type { CategorySetting } from '@/api';
import { Body, Button, Card, Label, Small } from '@/components/ui';
import { space, usePalette } from '@/theme';

/** The work-expense card's presentational parts (WorkExpenseCard wires them to the API). */

/** The card's face. Presentational, so it can be rendered in a test. */
export function WorkExpenseSummary({
  category,
  hint,
  status,
  canEdit,
  busy = false,
  error = null,
  onChoose,
  onConfirm,
}: {
  category: string | null;
  hint: string | null;
  status: ReturnType<typeof workExpenseStatus>;
  canEdit: boolean;
  busy?: boolean;
  error?: string | null;
  onChoose: () => void;
  onConfirm: () => void;
}) {
  const p = usePalette();
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Label>Tax return</Label>
        <Body strong>{category ?? 'No category'}</Body>
        {hint ? <Small>{hint}</Small> : null}
        <Small muted={status.kind !== 'counted'} style={status.kind === 'counted' ? { color: p.accentText } : undefined}>
          {status.text}
        </Small>
        {error ? <Small style={{ color: p.risk }}>{error}</Small> : null}
        {canEdit ? (
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            {status.kind === 'to_confirm' ? <Button label="Confirm category" busy={busy} onPress={onConfirm} /> : null}
            <Button
              tone="outline"
              label={category ? 'Change category' : 'Choose a category'}
              disabled={busy}
              onPress={onChoose}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** Tax categories first (with their ATO label), then everyday spending, then none. */
export function CategoryOptions({
  categories,
  currentId,
  selected,
  onSelect,
}: {
  categories: readonly CategorySetting[];
  currentId: string | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const groups = pickerGroups(categories, currentId);
  return (
    <View style={{ gap: space.md }}>
      {groups.tax.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <Label>Work and other tax deductions</Label>
          {groups.tax.map((c) => (
            <Option key={c.id} label={c.name} hint={taxCategoryHint(c)} on={selected === c.id} onPress={() => onSelect(c.id)} />
          ))}
        </View>
      ) : null}
      <View style={{ gap: space.xs }}>
        <Label>Everyday spending</Label>
        {groups.everyday.map((c) => (
          <Option key={c.id} label={c.name} on={selected === c.id} onPress={() => onSelect(c.id)} />
        ))}
        <Option label="No category" on={selected === null} onPress={() => onSelect(null)} />
      </View>
    </View>
  );
}

function Option({ label, hint, on, onPress }: { label: string; hint?: string | null; on: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={hint ? `${label}, ${hint}` : label}
      onPress={onPress}
      style={{
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: on ? p.accent : p.ruleStrong,
        backgroundColor: on ? p.accentSoft : 'transparent',
      }}
    >
      <Body strong={on}>{label}</Body>
      {hint ? <Small>{hint}</Small> : null}
    </Pressable>
  );
}
