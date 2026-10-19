import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CategorySetting } from '@/api';
import { AddButton, Empty, Field, Loading, Sheet } from '@/components/form';
import { CategoryIcon } from '@/components/rich';
import { Chip, Figure, Screen, Section, Small } from '@/components/ui';
import { formatAud, numeric, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

/**
 * The categories spending is sorted into.
 *
 * Users must be able to add their own. A fixed list works until someone runs a
 * business the list did not anticipate, and then every receipt they own lands
 * in "Other" — which makes the analytics useless and the deduction estimate
 * worse than useless.
 *
 * A category with any history — a receipt, a budget, a subcategory — is never
 * deleted, only switched off: turning one off stops it being offered for new
 * captures, while the receipts already filed against it keep their category.
 * Deleting it would silently rewrite history, including quarters that have
 * already been reported to the ATO. An empty category someone added by
 * mistake has no such history to protect, so it can be deleted outright — the
 * server decides which case applies, not this screen; `deletable` on each row
 * is its answer.
 */
export default function CategoriesScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { workspace, isBusiness } = useWorkspace();
  const [rows, setRows] = useState<CategorySetting[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api().listCategorySettings(workspace));
  }, [workspace]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function add() {
    setError(null);
    try {
      setRows(
        await api().createCategory(
          name,
          workspace,
          isBusiness ? null : budget ? Number(budget).toFixed(4) : '0.0000',
        ),
      );
      setAdding(false);
      setName('');
      setBudget('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that category.');
    }
  }

  const all = rows ?? [];
  const active = all.filter((c) => c.active);
  const off = all.filter((c) => !c.active);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        <WorkspaceSwitch />

        {rows === null ? (
          <Loading />
        ) : (
          <>
            <View style={{ gap: 2 }}>
              <Figure size="h1">{all.length} categories</Figure>
              <Small>
                {isBusiness
                  ? 'Each one maps to a deduction label on the tax worksheet.'
                  : 'Give a category a budget and it appears on your month.'}
              </Small>
              <Small>
                An empty category can be deleted outright. One with receipts or a
                budget is switched off instead — that keeps its history exactly as
                filed.
              </Small>
            </View>

            <AddButton
              label="Add a category"
              onPress={() => {
                setError(null);
                setAdding(true);
              }}
            />

            {active.length === 0 ? (
              <Empty title="No categories yet" detail="Add one to start sorting your spending." />
            ) : (
              <View>
                {active.map((c, i) => (
                  <CategoryRow key={c.name} row={c} first={i === 0} onToggle={setRows} />
                ))}
              </View>
            )}

            {off.length > 0 ? (
              <Section label="Switched off" style={{ marginTop: space.lg }} rule={false}>
                {off.map((c, i) => (
                  <CategoryRow key={c.name} row={c} first={i === 0} onToggle={setRows} />
                ))}
                <Small style={{ marginTop: space.md }}>
                  These are no longer offered for new receipts. Everything already filed against
                  them keeps its category.
                </Small>
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>

      <Sheet
        open={adding}
        title="Add a category"
        subtitle={
          isBusiness
            ? 'It becomes available the next time you file a receipt.'
            : 'Set a monthly budget now or leave it at zero.'
        }
        error={error}
        submitLabel="Add category"
        submitDisabled={!name.trim()}
        onClose={() => setAdding(false)}
        onSubmit={add}
      >
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={isBusiness ? 'Subcontractors' : 'Pets'}
          autoFocus
        />
        {!isBusiness ? (
          <Field
            label="Monthly budget"
            value={budget}
            onChangeText={setBudget}
            keyboardType="decimal-pad"
            prefix="$"
            hint="Optional — you can set it later on the budgets screen"
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

/**
 * One ledger row, with its two actions on a line of their own beneath. The
 * row is drawn like `LedgerRow` (same hairline, same lead/figure columns) but
 * is local because the actions are text keys, not a tap target for the row.
 */
function CategoryRow({
  row,
  first,
  onToggle,
}: {
  row: CategorySetting;
  first: boolean;
  onToggle: (rows: CategorySetting[]) => void;
}) {
  const p = usePalette();
  const [busy, setBusy] = useState(false);

  return (
    <View
      style={{
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
        paddingVertical: space.md,
        gap: space.sm,
        opacity: row.active ? 1 : 0.6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <CategoryIcon category={row.name} size={36} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
            {row.name}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Small>
              {row.documentCount} receipt{row.documentCount === 1 ? '' : 's'}
            </Small>
            {row.taxLabel ? <Chip>{row.taxLabel}</Chip> : null}
            {row.monthlyBudget ? (
              <Text style={[type.mono, numeric, { color: p.inkMuted }]}>
                {formatAud(row.monthlyBudget, { cents: false })}/mo
              </Text>
            ) : null}
          </View>
        </View>
        <Text style={[type.amount, numeric, { color: p.ink }]}>
          {formatAud(row.totalSpend, { cents: false })}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xl, paddingLeft: 48 }}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: row.active }}
          disabled={busy}
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
          onPress={() => {
            setBusy(true);
            void api()
              .setCategoryActive(row.name, !row.active)
              .then(onToggle)
              .finally(() => setBusy(false));
          }}
        >
          <Text style={[type.smallStrong, { color: p.accentText }]}>
            {row.active ? 'Switch off' : 'Switch back on'}
          </Text>
        </Pressable>

        {row.deletable ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
            onPress={() => {
              Alert.alert(
                `Delete ${row.name}?`,
                'Nothing is filed against it, so this removes it outright. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      setBusy(true);
                      void api()
                        .deleteCategory(row.name)
                        .then(onToggle)
                        .catch((e) =>
                          Alert.alert(
                            'Cannot delete',
                            e instanceof Error ? e.message : 'Could not delete that category.',
                          ),
                        )
                        .finally(() => setBusy(false));
                    },
                  },
                ],
              );
            }}
          >
            <Text style={[type.smallStrong, { color: p.inkStrong }]}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
