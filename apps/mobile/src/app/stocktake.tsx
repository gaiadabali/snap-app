import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Item, type StockMovement } from '@/api';
import { Empty, Field, Loading, Sheet, StatRow } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, Button, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { formatAud, formatShortDate, space, usePalette } from '@/theme';

/**
 * Stock take: count what is actually on the shelf.
 *
 * A count is recorded as a movement rather than written straight over the
 * number, because the difference between what the system thought and what was
 * there is the only interesting part. Overwriting it silently loses exactly
 * the information a stock take exists to produce.
 */
export default function StockTakeScreen() {
  // Business-only. Personal-only hides this from every nav path; this covers
  // a direct URL on the web build, where a route always resolves.
  if (!BUSINESS_FEATURES_ENABLED) return <Redirect href="/" />;
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Item[] | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [counting, setCounting] = useState<Item | null>(null);
  const [count, setCount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [i, m] = await Promise.all([api().listItems(), api().listStockMovements()]);
    setItems(i);
    setMovements(m);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const stocked = (items ?? []).filter((i) => i.stockOnHand !== null);
  const low = stocked.filter((i) => i.lowStock);
  const value = stocked.reduce((a, i) => a + (i.stockOnHand ?? 0) * Number(i.costPrice), 0);

  async function save() {
    if (!counting) return;
    setError(null);
    try {
      await api().countStock(counting.id, Number(count));
      await load();
      setCounting(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that count.');
    }
  }

  const difference =
    counting && count !== '' ? Number(count) - (counting.stockOnHand ?? 0) : null;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {items === null ? (
          <Loading />
        ) : (
          <>
            <Raised>
              <StatRow
                stats={[
                  {
                    label: 'Stock at cost',
                    value: formatAud(value.toFixed(4), { cents: false }),
                    hint: `${stocked.length} stocked items`,
                  },
                  {
                    label: 'Low or out',
                    value: String(low.length),
                    hint: low.length > 0 ? low.map((i) => i.name).join(', ') : 'Nothing to reorder',
                  },
                ]}
              />
            </Raised>

            <View style={{ gap: space.sm }}>
              <Label>Count</Label>
              {stocked.length === 0 ? (
                <Empty
                  title="Nothing stocked"
                  detail="Items with a stock quantity appear here to be counted."
                />
              ) : (
                <Raised style={{ padding: 0 }}>
                  {stocked.map((i, idx) => (
                    <View key={i.id}>
                      {idx > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.md,
                          paddingHorizontal: space.lg,
                          paddingVertical: 13,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong numberOfLines={1}>
                            {i.name}
                          </Body>
                          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                            <Small>{i.sku}</Small>
                            {i.stockOnHand === 0 ? (
                              <Chip tone="risk">Out of stock</Chip>
                            ) : i.lowStock ? (
                              <Chip tone="warn">Low</Chip>
                            ) : null}
                          </View>
                        </View>
                        <Figure size="h2" tone={i.lowStock ? 'risk' : 'ink'}>
                          {String(i.stockOnHand)}
                        </Figure>
                        <Button
                          label="Count"
                          tone="outline"
                          onPress={() => {
                            setCounting(i);
                            setCount(String(i.stockOnHand ?? 0));
                            setError(null);
                          }}
                          style={{ paddingVertical: 8, paddingHorizontal: space.md }}
                        />
                      </View>
                    </View>
                  ))}
                </Raised>
              )}
            </View>

            <View style={{ gap: space.sm }}>
              <Label>Recent movements</Label>
              <Raised style={{ padding: 0 }}>
                {movements.slice(0, 10).map((m, i) => (
                  <View key={m.id}>
                    {i > 0 ? <Divider style={{ marginLeft: space.lg }} /> : null}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.md,
                        paddingHorizontal: space.lg,
                        paddingVertical: 11,
                      }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Body numberOfLines={1}>{m.itemName}</Body>
                        <Small numberOfLines={1}>
                          {formatShortDate(m.at)} · {m.note ?? m.kind}
                          {m.byName ? ` · ${m.byName}` : ''}
                        </Small>
                      </View>
                      <Figure
                        size="body"
                        style={{
                          color: m.quantity < 0 ? p.risk : m.quantity > 0 ? p.accent : p.inkMuted,
                          fontWeight: '700',
                        }}
                      >
                        {m.quantity > 0 ? `+${m.quantity}` : String(m.quantity)}
                      </Figure>
                    </View>
                  </View>
                ))}
              </Raised>
            </View>
          </>
        )}
      </ScrollView>

      <Sheet
        open={counting !== null}
        title={counting?.name ?? ''}
        subtitle={
          counting ? `System says ${counting.stockOnHand}. Enter what you actually counted.` : undefined
        }
        error={error}
        submitLabel="Record count"
        submitDisabled={count === '' || Number(count) < 0}
        onClose={() => setCounting(null)}
        onSubmit={save}
      >
        <Field
          label="Counted quantity"
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          autoFocus
          hint={
            difference === null || difference === 0
              ? 'No difference'
              : `${difference > 0 ? 'Surplus' : 'Shortfall'} of ${Math.abs(difference)}`
          }
        />
      </Sheet>
    </Screen>
  );
}
