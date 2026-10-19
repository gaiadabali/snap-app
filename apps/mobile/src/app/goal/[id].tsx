import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Goal, type GoalContribution } from '@/api';
import { Icon } from '@/components/Icon';
import { GradientHero, HeroBody, HeroFigure, HeroLabel } from '@/components/rich';
import {
  IconButton,
  LedgerRow,
  Notice,
  ProgressBar,
  Screen,
  ScreenHeader,
  Section,
  Small,
} from '@/components/ui';
import { formatAud, numeric, onVoid, space, type, usePalette } from '@/theme';

/**
 * One savings goal, and every payment into it.
 *
 * This replaced a sheet on the Goals list — the ledger and the one destructive
 * action on it (removing a payment) live here together, rather than in two
 * places that can disagree about the total.
 *
 * `saved` is DERIVED on the server — the sum of the contributions below — so
 * the figure in the hero and the rows under it are the same fact twice, not
 * two numbers that might drift. The panel is the only dark thing here; what
 * was paid in is a ledger under it, one hairline-divided row per payment.
 */
export default function GoalDetailScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [goal, setGoal] = useState<Goal | null | undefined>(undefined);
  const [ledger, setLedger] = useState<GoalContribution[]>([]);

  const reload = useCallback(async () => {
    const [list, rows] = await Promise.all([
      api().listGoals(),
      api().listGoalContributions(id),
    ]);
    setGoal(list.find((g) => g.id === id) ?? null);
    setLedger(rows);
  }, [id]);

  /* Removing a contribution used to live in a sheet on the Goals list. It
     moved here with the ledger rather than being duplicated: two screens that
     can both delete the same row are two chances to disagree about the total. */
  function confirmRemove(c: GoalContribution) {
    Alert.alert(
      'Remove this payment?',
      `${formatAud(c.amount)} comes back out of the total.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void api()
              .removeGoalContribution(id, c.id)
              .then(() => reload())
              .catch(() => {});
          },
        },
      ],
    );
  }

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .listGoals()
        .then((list) => live && setGoal(list.find((g) => g.id === id) ?? null))
        .catch(() => live && setGoal(null));
      void api()
        .listGoalContributions(id)
        .then((c) => live && setLedger(c))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, [id]),
  );

  const saved = Number(goal?.saved ?? 0);
  const target = Number(goal?.target ?? 0);
  const pct = target > 0 ? saved / target : 0;
  const short = Math.max(0, target - saved);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.lg,
        }}
      >
        <ScreenHeader title={goal?.name ?? 'Goal'} onBack={() => router.back()} />

        {goal === null ? <Small>That goal is no longer here.</Small> : null}

        {goal ? (
          <>
            {/* The saved figure leads, the target is the line under it, and
                the meter carries the same fraction as the percentage so the
                two cannot disagree. */}
            <GradientHero>
              <HeroLabel>Saved</HeroLabel>
              <View style={{ marginTop: 14, minHeight: 56 }}>
                <HeroFigure settle>{formatAud(goal.saved, { cents: false })}</HeroFigure>
              </View>
              <HeroBody>of {formatAud(goal.target, { cents: false })}</HeroBody>

              <View style={{ marginTop: 22, gap: 8 }}>
                <ProgressBar
                  value={pct}
                  height={3}
                  track={onVoid.track}
                  tone={goal.done ? onVoid.good : p.voidInk}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                  <Text style={[type.label, numeric, { color: p.voidMuted }]}>
                    {Math.round(pct * 100)}%
                    {' · '}
                    {goal.done ? 'fully funded' : `${formatAud(String(short), { cents: false })} to go`}
                  </Text>
                  {goal.perMonth && !goal.done ? (
                    <Text style={[type.label, numeric, { color: onVoid.accent }]}>
                      {formatAud(goal.perMonth, { cents: false })} a month
                    </Text>
                  ) : null}
                </View>
              </View>
            </GradientHero>

            {goal.done ? (
              <Notice tone="good" icon="check">
                Fully funded. Nothing more to put aside — spend it, or raise the target if the
                plan grew.
              </Notice>
            ) : null}

            <Section label="Paid in" style={{ marginTop: space.lg }} rule={false}>
              {ledger.map((c, i) => (
                <LedgerRow
                  key={c.id}
                  first={i === 0}
                  title={sourceLabel(c)}
                  note={`${new Date(c.occurredOn).toLocaleDateString('en-AU', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}${c.createdByName ? ` · ${c.createdByName}` : ''}`}
                  figure={formatAud(c.amount)}
                  trailing={
                    <IconButton
                      name="close"
                      size={17}
                      color={p.inkFaint}
                      label={`Remove this payment of ${formatAud(c.amount)}`}
                      onPress={() => confirmRemove(c)}
                    />
                  }
                />
              ))}

              {ledger.length === 0 ? (
                <View
                  style={{
                    alignItems: 'center',
                    gap: 6,
                    paddingVertical: 28,
                    borderTopWidth: 1,
                    borderTopColor: p.rule,
                  }}
                >
                  <Icon name="bank" size={26} color={p.inkMuted} />
                  <Small>Nothing paid in yet.</Small>
                </View>
              ) : null}
              {ledger.length > 0 ? (
                <Small style={{ marginTop: space.md }}>
                  {ledger.length} payment{ledger.length === 1 ? '' : 's'}, adding to{' '}
                  {formatAud(goal.saved)}.
                </Small>
              ) : null}
            </Section>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * What told the app this happened.
 *
 * A `'statement_line'` row is stronger evidence than a typed one, and the
 * contract is emphatic that neither should be called "verified" — so the
 * label says what was OBSERVED, not how much to trust it.
 */
function sourceLabel(c: GoalContribution): string {
  if (c.source === 'opening_balance') return 'Starting balance';
  if (c.source === 'statement_line') return 'Seen on a statement';
  return `Added by ${c.createdByName ?? 'you'}`;
}
