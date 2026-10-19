import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CreditBalance, type PlanUsage } from '@/api';
import { Loading } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Tile } from '@/components/rich';
import { Body, Button, Card, Chip, Label, LedgerRow, ProgressBar, Screen, Section } from '@/components/ui';
import { space, usePalette } from '@/theme';

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
                <HeroFigure settle>
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

            <Section label="This month" style={{ marginTop: space.lg }}>
              {/* A COUNT, not a quota. `scanQuota` was the monthly allowance a
                  plan bought; there is no allowance now, so a meter filling
                  towards a cap would be measuring against a limit that does
                  not exist. What is still true is how many documents this
                  workspace has read this month. Seats ARE capped, so they are
                  the one thing here that gets a meter. */}
              <View style={{ flexDirection: 'row', gap: space.lg, paddingTop: space.md }}>
                <Tile
                  label="Read this month"
                  value={`${plan.scansUsed}`}
                  hint="One credit each"
                />
                <Tile
                  label="Seats"
                  value={`${plan.seatsUsed} of ${plan.seatLimit}`}
                  hint={seatPct >= 1 ? 'Every seat is taken' : 'In use'}
                  tone={seatPct >= 1 ? 'accent' : 'default'}
                />
              </View>
              <View style={{ marginTop: space.md }}>
                <ProgressBar value={seatPct} tone={seatPct >= 1 ? p.warn : p.accent} />
              </View>

              <View style={{ marginTop: space.lg }}>
                <LedgerRow
                  first
                  title="Results"
                  note={plan.realtime ? 'Extraction runs immediately' : 'Batched, same accuracy'}
                  figure={plan.realtime ? 'Real time' : 'Within the hour'}
                />
                <LedgerRow
                  title="Records kept"
                  note="What the ATO requires"
                  figure={`${Math.round(plan.retentionMonths / 12)} years`}
                />
              </View>
            </Section>

            <Section label="If you run out of scans" style={{ marginTop: space.lg }}>
              <View style={{ paddingTop: space.md }}>
                <Body>
                  The photo is still captured and queued — a receipt you cannot re-photograph is
                  never dropped because of a quota. Extraction resumes when the month rolls over,
                  or immediately if you have credits — a separate, never-expiring balance.
                </Body>
              </View>
            </Section>

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
