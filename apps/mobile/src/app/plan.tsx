import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditBalance, type PlanUsage } from '@/api';
import { Loading, StatRow } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Card, Chip, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { formatShortDate, radius, space, usePalette } from '@/theme';

/**
 * Plan and usage.
 *
 * Two limits matter and they fail differently. Scans are metered — running out
 * must never lose a capture, so the honest behaviour is to accept the photo
 * and queue it. Seats are structural — you cannot half-invite someone — so the
 * limit is enforced at the point of inviting, where it can be explained.
 */
export default function PlanScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);

  const load = useCallback(async () => {
    // Both, in parallel: the balance is the headline and the usage figures
    // are what remains true underneath it.
    const [usage, balance] = await Promise.all([
      api().getPlanUsage(),
      api().getCreditBalance(),
    ]);
    setPlan(usage);
    setCredits(balance);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const seatPct = plan ? Math.min(1, plan.seatsUsed / plan.seatLimit) : 0;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {plan === null ? (
          <Loading />
        ) : (
          <>
            {/* CREDITS, not a subscription.
                This said "$9.99 a month · renews 14 Oct" off
                `planName`/`priceCents`/`periodEnds`. There is no monthly
                charge and no renewal date to state: a credit is bought once
                and never expires (ECOSYSTEM D27 — credits "never reset",
                unlike the plan quota that used to sit here).
                Stating a renewal date under a credit system is not a stale
                label, it is a claim about somebody's money that is not true. */}
            <GradientHero>
              <View style={{ gap: space.xs }}>
                <HeroLabel>Credits</HeroLabel>
                <HeroFigure small>
                  {credits === null ? '—' : `${credits.creditsRemaining}`}
                </HeroFigure>
                <HeroBody>
                  One credit reads one document. They do not expire and there is nothing to
                  renew.
                </HeroBody>
              </View>
            </GradientHero>

            {plan.firmName ? (
              <Card tone="accent">
                <View style={{ gap: space.xs }}>
                  <Label style={{ color: p.accent }}>Through your accountant</Label>
                  <Body>
                    {plan.firmName} manages this workspace, and can see what you have shared with
                    them.
                  </Body>
                </View>
              </Card>
            ) : null}

            <Raised style={{ gap: space.md }}>
              <Label>This month</Label>
              {/* A COUNT, not a quota. `scanQuota` was the monthly allowance a
                  plan bought; there is no allowance now, so a meter filling
                  towards a cap would be measuring against a limit that does
                  not exist. What is still true is how many documents this
                  workspace has read this month. */}
              <StatRow
                stats={[
                  {
                    label: 'Read this month',
                    value: `${plan.scansUsed}`,
                    hint: 'One credit each',
                  },
                ]}
              />
              <Meter
                label="Seats"
                used={`${plan.seatsUsed}`}
                cap={`of ${plan.seatLimit}`}
                fraction={seatPct}
                tone={seatPct >= 1 ? 'risk' : 'accent'}
              />
              <Divider />
              <StatRow
                stats={[
                  {
                    label: 'Results',
                    value: plan.realtime ? 'Real time' : 'Within the hour',
                    hint: plan.realtime ? 'Extraction runs immediately' : 'Batched, same accuracy',
                  },
                  {
                    label: 'Records kept',
                    value: `${Math.round(plan.retentionMonths / 12)} years`,
                    hint: 'What the ATO requires',
                  },
                ]}
              />
            </Raised>

            <Card>
              <View style={{ gap: space.xs }}>
                <Label>If you run out of scans</Label>
                <Body>
                  The photo is still captured and queued — a receipt you cannot re-photograph is
                  never dropped because of a quota. Extraction resumes when the month rolls over,
                  or immediately if you have credits — a separate, never-expiring balance.
                </Body>
              </View>
            </Card>

            <View style={{ gap: space.sm }}>
              <Button label="Credits" tone="outline" onPress={() => router.push('/credits')} />
              <Button label="Points" tone="outline" onPress={() => router.push('/points')} />
              <Button
                label="Manage people and seats"
                tone="outline"
                onPress={() => router.push('/members')}
              />
              <Chip>Billing changes arrive with the server</Chip>
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Meter({
  label,
  used,
  cap,
  fraction,
  tone,
}: {
  label: string;
  used: string;
  cap: string;
  fraction: number;
  tone: 'accent' | 'risk';
}) {
  const p = usePalette();
  const colour = tone === 'risk' ? p.risk : p.accent;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Body strong>{label}</Body>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Figure size="h2" tone={tone === 'risk' ? 'risk' : 'ink'}>
            {used}
          </Figure>
          <Small>{cap}</Small>
        </View>
      </View>
      <View
        style={{
          height: 8,
          borderRadius: radius.pill,
          backgroundColor: p.surfaceAlt,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(2, fraction * 100)}%`,
            height: '100%',
            borderRadius: radius.pill,
            backgroundColor: colour,
          }}
        />
      </View>
    </View>
  );
}
