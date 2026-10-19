import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, api, type PersonalSummary } from '@/api';
import { AddButton, Field, Sheet } from '@/components/form';
import { GradientHero } from '@/components/rich';
import { ProgressBar, Screen, Section, Small } from '@/components/ui';
import { formatAud, numeric, onVoid, space, type, usePalette } from '@/theme';

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
  const budgetUsed = summary
    ? Number(summary.spentThisMonth) / Math.max(Number(summary.budgetTotal), 1)
    : 0;
  // Where you should be by now if the month were spent evenly — the same tick
  // Home draws, so the two screens read the same way.
  const daysInMonth = summary ? summary.daysElapsed + summary.daysLeftInMonth - 1 : 0;
  const monthElapsed = summary ? summary.daysElapsed / daysInMonth : 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl + insets.bottom,
        }}
      >
        <Text style={[type.display, { color: p.ink }]} accessibilityRole="header">
          Budgets
        </Text>

        {summary === null ? (
          <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
            <ActivityIndicator color={p.accent} />
          </View>
        ) : (
          <>
            {/* Four figures, not one. The prototype leads Budgets with the
                whole picture — spent against budgeted, how far through the
                month, and what today allows — because "what is my budget" is
                not a question anyone opens this screen to ask. Spent and
                budgeted are two readouts on the one panel, the meter under
                them carries the month-elapsed tick, and the days left and the
                daily allowance sit on the panel's footer rule. */}
            <GradientHero tone={over ? 'risk' : 'brand'} style={{ marginTop: space.lg }}>
              <View style={{ flexDirection: 'row' }}>
                <HeroStat label="Spent" value={formatAud(summary.spentThisMonth, { cents: false })} />
                <View style={{ width: 1, backgroundColor: p.voidRule, marginRight: space.lg }} />
                <HeroStat
                  label="Budgeted"
                  value={formatAud(summary.budgetTotal, { cents: false })}
                />
              </View>

              <View style={{ marginTop: 22, gap: 8 }}>
                <ProgressBar
                  value={budgetUsed}
                  marker={monthElapsed}
                  height={3}
                  track={onVoid.track}
                  tone={over ? onVoid.risk : p.voidInk}
                  markerColor={onVoid.accent}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[type.label, numeric, { color: over ? onVoid.risk : p.voidMuted }]}>
                    Spent {Math.round(budgetUsed * 100)}%
                  </Text>
                  <Text style={[type.label, numeric, { color: onVoid.accent }]}>
                    Day {summary.daysElapsed}/{daysInMonth}
                  </Text>
                </View>
              </View>

              <View
                style={{
                  marginTop: 18,
                  marginHorizontal: -20,
                  marginBottom: -20,
                  borderTopWidth: 1,
                  borderTopColor: p.voidRule,
                  flexDirection: 'row',
                }}
              >
                <View style={{ flex: 1, paddingVertical: 14, paddingLeft: 20, gap: 3 }}>
                  <Text style={[type.label, { color: p.voidMuted }]}>
                    Left in {summary.monthLabel.split(' ')[0]}
                  </Text>
                  <Text style={[type.amount, numeric, { color: p.voidInk }]}>
                    {summary.daysLeftInMonth} day{summary.daysLeftInMonth === 1 ? '' : 's'}
                  </Text>
                </View>
                <View
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    paddingLeft: 16,
                    gap: 3,
                    borderLeftWidth: 1,
                    borderLeftColor: p.voidRule,
                  }}
                >
                  <Text style={[type.label, { color: p.voidMuted }]}>Safe to spend a day</Text>
                  <Text style={[type.amount, numeric, { color: p.voidInk }]}>
                    {formatAud(summary.safeToSpendPerDay)}
                  </Text>
                </View>
              </View>
            </GradientHero>

            <Section label="Per category" style={{ marginTop: space.xxl }}>
              {summary.byCategory.map((c) => {
                const used = c.used ?? 0;
                const isOver = used > 1;
                return (
                  <View
                    key={c.category}
                    style={{
                      paddingVertical: space.md,
                      gap: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: p.rule,
                      opacity: busy === c.category ? 0.5 : 1,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
                          {c.category}
                        </Text>
                        <Text
                          style={[type.mono, numeric, { color: isOver ? p.risk : p.inkMuted }]}
                          numberOfLines={2}
                        >
                          {formatAud(c.spent)} spent
                          {c.budget
                            ? isOver
                              ? ` · ${formatAud(String(Number(c.spent) - Number(c.budget)))} over`
                              : ` · ${formatAud(String(Number(c.budget) - Number(c.spent)))} left`
                            : ' · no budget set'}
                        </Text>
                      </View>

                      <Stepper
                        onPress={() => void nudge(c.category, c.budget ?? '0', -10)}
                        glyph="−"
                      />
                      <Text
                        style={[
                          type.amount,
                          numeric,
                          { color: p.ink, minWidth: 58, textAlign: 'center' },
                        ]}
                      >
                        {formatAud(c.budget, { cents: false })}
                      </Text>
                      <Stepper
                        onPress={() => void nudge(c.category, c.budget ?? '0', 10)}
                        glyph="+"
                      />
                    </View>

                    <ProgressBar
                      value={Math.max(0.01, used)}
                      tone={isOver ? p.risk : p.accent}
                    />
                  </View>
                );
              })}
            </Section>

            <View style={{ marginTop: space.xl }}>
              <AddButton
                label="Add a category"
                onPress={() => {
                  setError(null);
                  setAdding(true);
                }}
              />
            </View>

            {/* This used to say budgets would sync "once the server lands" —
                stale the moment `HttpApi` shipped (`api/http.ts`), since a
                budget is workspace-scoped there and every member reads the
                same one already. The demo build has no server underneath
                it, so it says the true thing for that build instead. */}
            <Small style={{ textAlign: 'center', marginTop: space.lg }}>
              {IS_DEMO
                ? 'Saved on this device only — this is demo data, reset it from Settings.'
                : 'Everyone in this household sees the same budgets.'}
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

/** A compact outline key: a budget is nudged, not typed. */
function Stepper({ glyph, onPress }: { glyph: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={glyph === '+' ? 'Increase budget' : 'Decrease budget'}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: p.ruleStrong,
        backgroundColor: pressed ? p.surfaceAlt : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Text style={{ fontSize: 19, color: p.inkStrong, lineHeight: 22 }}>{glyph}</Text>
    </Pressable>
  );
}

/** One readout on the budgets panel: a mono label over a light figure. */
function HeroStat({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={[type.label, { color: p.voidMuted }]}>{label}</Text>
      <Text
        style={[type.display, numeric, { color: p.voidInk }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}
