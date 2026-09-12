import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CategorySetting } from '@/api';
import { AddButton, Empty, Field, Loading, Sheet } from '@/components/form';
import { CategoryIcon, Raised } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, space, usePalette } from '@/theme';
import { WorkspaceSwitch, useWorkspace } from '@/workspace';

/**
 * The categories spending is sorted into.
 *
 * Users must be able to add their own. A fixed list works until someone runs a
 * business the list did not anticipate, and then every receipt they own lands
 * in "Other" — which makes the analytics useless and the deduction estimate
 * worse than useless.
 *
 * A category is never deleted, only switched off: turning one off stops it
 * being offered for new captures, while the receipts already filed against it
 * keep their category. Deleting would silently rewrite history, including
 * quarters that have already been reported to the ATO.
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
              <Raised style={{ padding: 0 }}>
                {active.map((c, i) => (
                  <CategoryRow key={c.name} row={c} first={i === 0} onToggle={setRows} />
                ))}
              </Raised>
            )}

            {off.length > 0 ? (
              <View style={{ gap: space.sm }}>
                <Label>Switched off</Label>
                <Raised style={{ padding: 0 }}>
                  {off.map((c, i) => (
                    <CategoryRow key={c.name} row={c} first={i === 0} onToggle={setRows} />
                  ))}
                </Raised>
                <Small>
                  These are no longer offered for new receipts. Everything already filed against
                  them keeps its category.
                </Small>
              </View>
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
        paddingHorizontal: space.lg,
        paddingVertical: 13,
        gap: space.sm,
        opacity: row.active ? 1 : 0.6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <CategoryIcon category={row.name} size={36} />
        <View style={{ flex: 1, gap: 2 }}>
          <Body strong numberOfLines={1}>
            {row.name}
          </Body>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Small>
              {row.documentCount} receipt{row.documentCount === 1 ? '' : 's'}
            </Small>
            {row.taxLabel ? <Chip>{row.taxLabel}</Chip> : null}
            {row.monthlyBudget ? <Small>{formatAud(row.monthlyBudget, { cents: false })}/mo</Small> : null}
          </View>
        </View>
        <Figure size="h2">{formatAud(row.totalSpend, { cents: false })}</Figure>
      </View>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: row.active }}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void api()
            .setCategoryActive(row.name, !row.active)
            .then(onToggle)
            .finally(() => setBusy(false));
        }}
      >
        <Small muted={false} style={{ color: p.accent, fontWeight: '600' }}>
          {row.active ? 'Switch off' : 'Switch back on'}
        </Small>
      </Pressable>
    </View>
  );
}
