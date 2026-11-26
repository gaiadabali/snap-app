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
  lines = [],
  onMarkLines,
}: {
  category: string | null;
  hint: string | null;
  status: ReturnType<typeof workExpenseStatus>;
  canEdit: boolean;
  busy?: boolean;
  error?: string | null;
  onChoose: () => void;
  onConfirm: () => void;
  /** The receipt's lines; the ones marked as work are listed. */
  lines?: readonly WorkLineRow[];
  /** Opens the work-lines sheet; no button without it (or without lines). */
  onMarkLines?: () => void;
}) {
  const anyMarked = lines.some((l) => l.categoryId);
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
        <MarkedLines lines={lines} />
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
            {onMarkLines && lines.length > 0 ? (
              <Button
                tone="outline"
                label={anyMarked ? 'Change work lines' : 'Mark work lines'}
                disabled={busy}
                onPress={onMarkLines}
              />
            ) : null}
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

/** One receipt line as the work-lines parts show it. */
export interface WorkLineRow {
  lineNumber: number;
  description: string;
  /** What the line cost, GST included (`$25.00`). */
  paid: string;
  /** The category it is filed in on its own, or null; '' while ticked with none chosen yet (the sheet only). */
  categoryId: string | null;
  categoryName: string | null;
}

/** The lines marked as work, on the card's face: one line each, with its category. */
export function MarkedLines({ lines }: { lines: readonly WorkLineRow[] }) {
  const marked = lines.filter((l) => l.categoryId);
  if (marked.length === 0) return null;
  return (
    <View style={{ gap: space.xs }} accessibilityLabel="Lines marked as work">
      {marked.map((l) => (
        <Small key={l.lineNumber}>
          {`${l.description} · ${l.paid} · ${l.categoryName ?? 'Work category'}`}
        </Small>
      ))}
    </View>
  );
}

/**
 * The work-lines sheet's body: every line with a checkbox; a checked line shows its work
 * category, and the open one lists the work and tax categories to choose from. The running
 * total sits at the end. Presentational, so it can be rendered in a test.
 */
export function WorkLineOptions({
  lines,
  categories,
  openLine,
  total,
  onToggle,
  onOpen,
  onPick,
}: {
  lines: readonly WorkLineRow[];
  categories: readonly CategorySetting[];
  /** The line whose category list is showing, or null. */
  openLine: number | null;
  /** The running total of the checked lines, GST included (`$25.00`). */
  total: string;
  onToggle: (lineNumber: number) => void;
  onOpen: (lineNumber: number) => void;
  onPick: (lineNumber: number, categoryId: string) => void;
}) {
  const p = usePalette();
  const tax = pickerGroups(categories, null).tax;
  return (
    <View style={{ gap: space.sm }}>
      {lines.map((l) => {
        // '' is a ticked line whose work category is still to be chosen.
        const on = l.categoryId !== null;
        return (
          <View key={l.lineNumber} style={{ gap: space.xs }}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              // The PWA (react-native-web) reads the aria prop, not accessibilityState.
              aria-checked={on}
              accessibilityLabel={`${l.description}, ${l.paid}${on ? `, work: ${l.categoryName ?? 'choose a category'}` : ''}`}
              onPress={() => onToggle(l.lineNumber)}
              style={{
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: on ? p.accent : p.ruleStrong,
                backgroundColor: on ? p.accentSoft : 'transparent',
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: on ? p.accent : p.ruleStrong,
                  backgroundColor: on ? p.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* White on the brand fill in both schemes (tokens.ts). */}
                {on ? <Body style={{ color: '#fff', fontWeight: '700' }}>✓</Body> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Body strong={on}>{l.description}</Body>
                {on ? <Small>{l.categoryName ?? 'Choose a work category'}</Small> : null}
              </View>
              <Body>{l.paid}</Body>
            </Pressable>
            {on && openLine !== l.lineNumber ? (
              <Pressable accessibilityRole="button" onPress={() => onOpen(l.lineNumber)} style={{ alignSelf: 'flex-start', paddingVertical: space.xs, paddingHorizontal: space.md }}>
                <Small style={{ color: p.accentText }}>{`Change category for ${l.description}`}</Small>
              </Pressable>
            ) : null}
            {on && openLine === l.lineNumber ? (
              <View style={{ gap: space.xs, paddingLeft: space.md }} accessibilityLabel={`Work category for ${l.description}`}>
                {tax.map((c) => (
                  <Option key={c.id} label={c.name} hint={taxCategoryHint(c)} on={l.categoryId === c.id} onPress={() => onPick(l.lineNumber, c.id)} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      <View accessibilityLiveRegion="polite" style={{ paddingTop: space.sm }}>
        <Body strong>{`Marked for work: ${total}`}</Body>
        <Small muted>GST included. Lines you don’t tick stay with the rest of the receipt.</Small>
      </View>
    </View>
  );
}
