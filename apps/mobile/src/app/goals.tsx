import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Goal } from '@/api';
import { AddButton, Empty, Field, Loading, Sheet } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import { Button, Chip, ProgressBar, Screen, Section, Small } from '@/components/ui';
import { formatAud, formatShortDate, numeric, space, type, usePalette } from '@/theme';

/**
 * Savings goals.
 *
 * The useful number is not what has been saved — it is what has to go in each
 * month to land it on time. A progress bar tells you about the past; a monthly
 * figure tells you what to do, which is the same reason the personal home
 * screen leads with what is left rather than what is spent.
 */
export default function GoalsScreen() {
  const router = useRouter();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setGoals(await api().listGoals());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const all = goals ?? [];
  const saved = all.reduce((a, g) => a + Number(g.saved), 0);
  const targets = all.reduce((a, g) => a + Number(g.target), 0);
  const perMonth = all.reduce((a, g) => a + Number(g.perMonth ?? 0), 0);
  // Derived from `all` rather than snapshotted at open time, so removing a
  // contribution updates the total shown in the history sheet immediately.

  async function create() {
    setError(null);
    try {
      setGoals(
        await api().createGoal(name, Number(target).toFixed(4), date.trim() || null),
      );
      setAdding(false);
      setName('');
      setTarget('');
      setDate('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that goal.');
    }
  }

  async function contribute() {
    if (!contributing) return;
    setError(null);
    try {
      setGoals(await api().contributeToGoal(contributing.id, Number(amount).toFixed(4)));
      setContributing(null);
      setAmount('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add that.');
    }
  }

  function remove(goal: Goal) {
    Alert.alert(`Delete ${goal.name}?`, 'The goal is removed. No money moves.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void api().deleteGoal(goal.id).then(setGoals),
      },
    ]);
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {goals === null ? (
          <Loading />
        ) : (
          <>
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Saved so far</HeroLabel>
                <HeroFigure settle>{formatAud(saved.toFixed(4), { cents: false })}</HeroFigure>
                <HeroBody>
                  of {formatAud(targets.toFixed(4), { cents: false })} across {all.length}{' '}
                  {all.length === 1 ? 'goal' : 'goals'}
                  {perMonth > 0
                    ? ` · ${formatAud(perMonth.toFixed(4), { cents: false })} a month to stay on track`
                    : ''}
                </HeroBody>
              </View>
            </GradientHero>

            <AddButton
              label="Start a goal"
              onPress={() => {
                setError(null);
                setAdding(true);
              }}
            />

            {all.length === 0 ? (
              <Empty
                title="No goals yet"
                detail="Put a name and a date on something you are saving for."
              />
            ) : (
              <Section label="Your goals" rule={false}>
                {all.map((g, i) => {
                  const fraction = Math.min(1, Number(g.saved) / Math.max(Number(g.target), 1));
                  return (
                    <View
                      key={g.id}
                      style={{
                        paddingVertical: space.lg,
                        gap: space.sm,
                        borderTopWidth: i === 0 ? 0 : 1,
                        borderTopColor: p.rule,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}
                        >
                          <Text
                            style={[type.bodyStrong, { color: p.ink, flexShrink: 1 }]}
                            numberOfLines={1}
                          >
                            {g.name}
                          </Text>
                          {g.done ? <Chip tone="accent">Funded</Chip> : null}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Delete ${g.name}`}
                          hitSlop={8}
                          onPress={() => remove(g)}
                        >
                          <Text style={{ color: p.inkFaint, fontSize: 18 }}>×</Text>
                        </Pressable>
                      </View>

                      <ProgressBar value={fraction} tone={g.done ? p.accent : p.scan} />

                      <Text style={[type.mono, numeric, { color: p.inkMuted }]}>
                        {Math.round(fraction * 100)}% · {formatAud(g.saved)} of {formatAud(g.target)}
                        {g.targetDate ? ` · by ${formatShortDate(g.targetDate)}` : ' · no deadline'}
                      </Text>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          {g.done ? (
                            <Small>Reached. Nothing more needed.</Small>
                          ) : g.perMonth ? (
                            <Small>
                              <Small muted={false} style={[type.smallStrong, numeric, { color: p.ink }]}>
                                {formatAud(g.perMonth)}
                              </Small>
                              {' a month to make the date'}
                            </Small>
                          ) : (
                            <Small>
                              {formatAud((Number(g.target) - Number(g.saved)).toFixed(4))} to go
                            </Small>
                          )}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`See contributions to ${g.name}`}
                          hitSlop={8}
                          onPress={() => router.push({ pathname: '/goal/[id]', params: { id: g.id } })}
                          style={{ paddingVertical: 9, paddingHorizontal: space.sm }}
                        >
                          <Text style={[type.smallStrong, { color: p.inkMuted }]}>History</Text>
                        </Pressable>
                        {!g.done ? (
                          <Button
                            label="Add"
                            tone="outline"
                            size="sm"
                            onPress={() => {
                              setContributing(g);
                              setAmount('');
                              setError(null);
                            }}
                            style={{ paddingVertical: 9, paddingHorizontal: space.lg }}
                          />
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </Section>
            )}
          </>
        )}
      </ScrollView>

      <Sheet
        open={adding}
        title="Start a goal"
        error={error}
        submitLabel="Create goal"
        submitDisabled={!name.trim() || Number(target) <= 0}
        onClose={() => setAdding(false)}
        onSubmit={create}
      >
        <Field label="Name" value={name} onChangeText={setName} placeholder="Queensland trip" autoFocus />
        <Field
          label="Target"
          value={target}
          onChangeText={setTarget}
          keyboardType="decimal-pad"
          prefix="$"
        />
        <Field
          label="By when"
          value={date}
          onChangeText={setDate}
          placeholder="2027-04-01"
          hint="Optional. With a date, the app works out the monthly amount."
        />
      </Sheet>

      <Sheet
        open={contributing !== null}
        title={contributing ? `Add to ${contributing.name}` : ''}
        subtitle={
          contributing
            ? `${formatAud((Number(contributing.target) - Number(contributing.saved)).toFixed(4))} to go`
            : undefined
        }
        error={error}
        submitLabel="Add"
        submitDisabled={Number(amount) <= 0}
        onClose={() => setContributing(null)}
        onSubmit={contribute}
      >
        <Field
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          prefix="$"
          autoFocus
        />
      </Sheet>

    </Screen>
  );
}
