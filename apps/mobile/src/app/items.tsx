import { Redirect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';

import { api, type Item } from '@/api';
import { AddButton, Choice, Field, Sheet } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { formatAud, radius, space, usePalette } from '@/theme';

const blank = { name: '', sku: '', unit: 'ea', sellPrice: '', costPrice: '', stock: '' };

export default function ItemsScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const [rows, setRows] = useState<Item[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'product' | 'service'>('product');
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api().listItems().then(setRows);
  }, []);

  const save = useCallback(async () => {
    setError(null);
    try {
      setRows(
        await api().createItem({
          name: draft.name.trim(),
          sku: draft.sku.trim().toUpperCase(),
          unit: draft.unit.trim() || 'ea',
          sellPrice: Number(draft.sellPrice || 0).toFixed(4),
          costPrice: Number(draft.costPrice || 0).toFixed(4),
          // A service has no stock at all, which is different from having none.
          stockOnHand: kind === 'service' ? null : Number(draft.stock || 0),
          taxCode: 'GSTONINCOME',
        }),
      );
      setAdding(false);
      setDraft(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that item.');
    }
  }, [draft, kind]);

  const all = rows ?? [];
  const stocked = all.filter((i) => i.stockOnHand !== null);
  const lowCount = all.filter((i) => i.lowStock).length;

  /** Stock value at cost — what is sitting on the shelf, not what it sells for. */
  const stockValue = useMemo(
    () => stocked.reduce((a, i) => a + Number(i.costPrice) * (i.stockOnHand ?? 0), 0),
    [stocked],
  );

  return (
    <Screen>
      <FlatList
        data={all}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl }}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <GradientHero tone={lowCount > 0 ? 'risk' : 'brand'}>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Stock on hand, at cost</HeroLabel>
                <HeroFigure>{formatAud(stockValue.toFixed(2))}</HeroFigure>
                <HeroBody>
                  {all.length} items · {stocked.length} stocked
                  {lowCount > 0 ? ` · ${lowCount} low or out` : ''}
                </HeroBody>
              </View>
            </GradientHero>

            <AddButton
              label="Add an item"
              onPress={() => {
                setError(null);
                setAdding(true);
              }}
            />
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        renderItem={({ item }) => {
          const isService = item.stockOnHand === null;
          const out = item.stockOnHand === 0;
          return (
            <Raised accent={out ? p.risk : item.lowStock ? p.warn : undefined}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: radius.md,
                    backgroundColor: isService ? '#5B6EF530' : '#F2994A30',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 18 }}>{isService ? '🛠' : '📦'}</Text>
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <Body strong numberOfLines={1}>
                    {item.name}
                  </Body>
                  <Small numberOfLines={1}>
                    {item.sku} · per {item.unit}
                  </Small>
                  {isService ? null : (
                    <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 2 }}>
                      {out ? (
                        <Chip tone="risk">Out of stock</Chip>
                      ) : item.lowStock ? (
                        <Chip tone="warn">{item.stockOnHand} left</Chip>
                      ) : (
                        <Chip tone="accent">{item.stockOnHand} in stock</Chip>
                      )}
                    </View>
                  )}
                </View>

                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Figure size="h2">{formatAud(item.sellPrice)}</Figure>
                  <Small>cost {formatAud(item.costPrice)}</Small>
                </View>
              </View>
            </Raised>
          );
        }}
        ListFooterComponent={
          all.length ? (
            <View style={{ paddingTop: space.lg, gap: space.xs }}>
              <Label>Note</Label>
              <Small>
                Prices are ex-GST. Sales add 10% on top; the tax code on each item decides which BAS
                label it lands on. Services carry no stock, so they never appear in a stock take.
              </Small>
            </View>
          ) : null
        }
      />
    
      <Sheet
        open={adding}
        title="Add an item"
        subtitle="Products and services you sell, for invoice lines."
        error={error}
        submitLabel="Add item"
        submitDisabled={!draft.name.trim() || Number(draft.sellPrice) <= 0}
        onClose={() => setAdding(false)}
        onSubmit={save}
      >
        <Field
          label="Name"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          placeholder="Line-haul freight"
          autoFocus
        />
        <Choice
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'product', label: 'Product' },
            { value: 'service', label: 'Service' },
          ]}
        />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Sell price"
              value={draft.sellPrice}
              onChangeText={(sellPrice) => setDraft({ ...draft, sellPrice })}
              keyboardType="decimal-pad"
              prefix="$"
              hint="Excluding GST"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Cost"
              value={draft.costPrice}
              onChangeText={(costPrice) => setDraft({ ...draft, costPrice })}
              keyboardType="decimal-pad"
              prefix="$"
            />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="SKU"
              value={draft.sku}
              onChangeText={(sku) => setDraft({ ...draft, sku })}
              placeholder="FRT-LH"
              autoCapitalize="characters"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Unit"
              value={draft.unit}
              onChangeText={(unit) => setDraft({ ...draft, unit })}
              placeholder="ea"
            />
          </View>
        </View>
        {kind === 'product' ? (
          <Field
            label="Stock on hand"
            value={draft.stock}
            onChangeText={(stock) => setDraft({ ...draft, stock })}
            keyboardType="number-pad"
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}
