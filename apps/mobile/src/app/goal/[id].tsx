import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Goal, type GoalContribution } from '@/api';
import { Icon } from '@/components/Icon';
import { GradientHero } from '@/components/rich';
import {
  Body,
  Card,
  IconButton,
  Notice,
  ProgressBar,
  Screen,
  ScreenHeader,
  Small,
} from '@/components/ui';
import { formatAud, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * One savings goal, and every payment into it.
 *
 * This replaced a sheet on the Goals list — the ledger and the one destructive
 * action on it (removing a payment) live here together, rather than in two
 * places that can disagree about the total.
 *
 * `saved` is DERIVED on the server — the sum of the contributions below — so
 * the figure in the hero and the rows under it are the same fact twice, not
 * two numbers that might drift.
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
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
      >
        <ScreenHeader title={goal?.name ?? 'Goal'} onBack={() => router.back()} />

        {goal === null ? <Small>That goal is no longer here.</Small> : null}

        {goal ? (
          <>
            <GradientHero style={{ borderRadius: radius.xl, gap: space.lg }}>
              <View style={{ flexDirection: 'row', gap: space.lg }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.h2, numeric, { color: '#FFFFFF' }]}>
                    {formatAud(goal.saved, { cents: false })}
                  </Text>
                  <Text style={[type.small, { color: 'rgba(255,255,255,0.95)' }]}>saved</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.h2, numeric, { color: '#FFFFFF' }]}>
                    {formatAud(goal.target, { cents: false })}
                  </Text>
                  <Text style={[type.small, { color: 'rgba(255,255,255,0.95)' }]}>target</Text>
                </View>
              </View>

              <View
                style={{
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${Math.min(100, Math.max(2, pct * 100))}%`,
                    height: '100%',
                    backgroundColor: '#FFFFFF',
                    opacity: 0.9,
                    borderRadius: 4,
                  }}
                />
              </View>

              <Text style={[type.body, { color: 'rgba(255,255,255,0.95)' }]}>
                {Math.round(pct * 100)}% ·{' '}
                {goal.done
                  ? 'fully funded'
                  : `${formatAud(String(short), { cents: false })} to go`}
                {goal.perMonth && !goal.done
                  ? ` · ${formatAud(goal.perMonth, { cents: false })} a month`
                  : ''}
              </Text>
            </GradientHero>

            {goal.done ? (
              <Notice tone="good" icon="check">
                Fully funded. Nothing more to put aside — spend it, or raise the target if the
                plan grew.
              </Notice>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Text style={[type.label, { color: p.inkMuted }]}>Paid in</Text>
              <Card padded={false}>
                {ledger.map((c, i) => (
                  <View
                    key={c.id}
                    style={{
                      minHeight: 62,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.md,
                      paddingHorizontal: space.lg,
                      paddingVertical: space.md,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Body strong>{sourceLabel(c)}</Body>
                      <Small>
                        {new Date(c.occurredOn).toLocaleDateString('en-AU', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {c.createdByName ? ` · ${c.createdByName}` : ''}
                      </Small>
                    </View>
                    <Text style={[type.bodyStrong, numeric, { color: p.ink }]}>
                      {formatAud(c.amount)}
                    </Text>
                    <IconButton
                      name="close"
                      size={17}
                      color={p.inkFaint}
                      label={`Remove this payment of ${formatAud(c.amount)}`}
                      onPress={() => confirmRemove(c)}
                    />
                  </View>
                ))}

                {ledger.length === 0 ? (
                  <View style={{ alignItems: 'center', gap: 6, paddingVertical: 28 }}>
                    <Icon name="bank" size={26} color={p.inkMuted} />
                    <Small>Nothing paid in yet.</Small>
                  </View>
                ) : null}
              </Card>
              {ledger.length > 0 ? (
                <Small>
                  {ledger.length} payment{ledger.length === 1 ? '' : 's'}, adding to{' '}
                  {formatAud(goal.saved)}.
                </Small>
              ) : null}
            </View>

            <ProgressBar value={pct} />
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
