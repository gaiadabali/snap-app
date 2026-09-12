import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type PersonalSummary } from '@/api';
import { AddButton, Field, Sheet } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Figure, Label, Screen, Small } from '@/components/ui';
import { formatAud, space, usePalette } from '@/theme';

/**
 * Budgets: what each category is allowed per month.
 *
 * Adjusted in $10 steps rather than typed. A budget is a decision, not a
 * measurement — the exact figure matters far less than being able to nudge it
 * while looking at what you actually spent, which is why the month's spend
 * sits on the same row as the control.
 */
export default function BudgetsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<PersonalSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSummary(await api().getPersonal());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const nudge = useCallback(
    async (category: string, current: string, by: number) => {
      const next = Math.max(0, Math.round(Number(current)) + by);
      setBusy(category);
      setSummary(await api().setBudget(category, next.toFixed(2)));
      setBusy(null);
    },
    [],
  );

  const addCategory = useCallback(async () => {
    setError(null);
    try {
      // Creating the category and setting its budget are the same act here:
      // a budget line IS how a category becomes visible before anything has
      // been spent against it.
      await api().createCategory(name, 'personal', Number(amount || 0).toFixed(4));
      setSummary(await api().getPersonal());
      setAdding(false);
      setName('');
      setAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that category.');
    }
  }, [name, amount]);

  const over = summary ? Number(summary.remaining) < 0 : false;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxl + insets.bottom,
          gap: space.lg,
        }}
      >
        {summary === null ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={p.accent} />
          </View>
        ) : (
          <>
            <GradientHero tone={over ? 'risk' : 'brand'}>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Monthly budget</HeroLabel>
                <HeroFigure>{formatAud(summary.budgetTotal, { cents: false })}</HeroFigure>
                <HeroBody>
                  {formatAud(summary.spentThisMonth, { cents: false })} spent in{' '}
                  {summary.monthLabel}
                </HeroBody>
              </View>
            </GradientHero>

            <View style={{ gap: space.sm }}>
              <Label>Per category</Label>
              <Raised style={{ padding: 0 }}>
                {summary.byCategory.map((c, i) => {
                  const used = c.used ?? 0;
                  const isOver = used > 1;
                  return (
                    <View
                      key={c.category}
                      style={{
                        paddingHorizontal: space.lg,
                        paddingVertical: 14,
                        gap: 10,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: p.rule,
                        opacity: busy === c.category ? 0.5 : 1,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Body strong>{c.category}</Body>
                          <Small>
                            {formatAud(c.spent)} spent
                            {c.budget
                              ? isOver
                                ? ` · ${formatAud(String(Number(c.spent) - Number(c.budget)))} over`
                                : ` · ${formatAud(String(Number(c.budget) - Number(c.spent)))} left`
                              : ' · no budget set'}
                          </Small>
                        </View>

                        <Stepper
                          onPress={() => void nudge(c.category, c.budget ?? '0', -10)}
                          glyph="−"
                        />
                        <Figure size="h2" style={{ minWidth: 74, textAlign: 'center' }}>
                          {formatAud(c.budget, { cents: false })}
                        </Figure>
                        <Stepper
                          onPress={() => void nudge(c.category, c.budget ?? '0', 10)}
                          glyph="+"
                        />
                      </View>

                      <View
                        style={{
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: p.surfaceAlt,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: `${Math.min(100, Math.max(1, used * 100))}%`,
                            height: '100%',
                            borderRadius: 3,
                            backgroundColor: isOver ? p.risk : p.accent,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </Raised>
            </View>

            <AddButton
              label="Add a category"
              onPress={() => {
                setError(null);
                setAdding(true);
              }}
            />

            <Small style={{ textAlign: 'center' }}>
              Saved on this device. They will sync across your household once the server lands.
            </Small>
          </>
        )}
      </ScrollView>
    
      <Sheet
        open={adding}
        title="Add a category"
        subtitle="It appears on your month straight away."
        error={error}
        submitLabel="Add category"
        submitDisabled={!name.trim()}
        onClose={() => setAdding(false)}
        onSubmit={addCategory}
      >
        <Field label="Name" value={name} onChangeText={setName} placeholder="Pets" autoFocus />
        <Field
          label="Monthly budget"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          prefix="$"
          hint="Adjust it later with the + and − buttons"
        />
      </Sheet>
    </Screen>
  );
}

function Stepper({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase budget' : 'Decrease budget'}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: pressed ? p.accent : p.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Text style={{ fontSize: 19, color: p.accent, fontWeight: '700', lineHeight: 22 }}>
        {glyph}
      </Text>
    </Pressable>
  );
}
