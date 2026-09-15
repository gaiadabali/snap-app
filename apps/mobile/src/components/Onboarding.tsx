import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { abnIsValid, api, type Session, type Workspace } from '@/api';
import { Choice, Field, Toggle } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, Button, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { radius, space, usePalette } from '@/theme';

/**
 * The first thing a new account sees.
 *
 * Three screens, in the order the answers matter, and each one is asked
 * because the app cannot do its job without it:
 *
 *   1. Business or personal — decides whether this workspace has a BAS at all.
 *   2. What it is called, and the ABN — an ABN is on every tax invoice you
 *      issue, and its checksum is checked here rather than at the point of
 *      billing a customer.
 *   3. GST registration, or a monthly budget — the one figure each side of the
 *      app is built around.
 *
 * Nothing else is asked. Occupation, categories and budgets per category all
 * have sensible starting points and can be changed later; front-loading them
 * is how onboarding gets abandoned.
 */

/** A handful of the tax engine's profiles, by the ones people recognise. */
const OCCUPATIONS = [
  { value: 'truckie_long', label: 'Truck driver' },
  { value: 'tradie', label: 'Tradesperson' },
  { value: 'nurse', label: 'Nurse or carer' },
  { value: 'sole', label: 'Sole trader, other' },
];

export function Onboarding({
  displayName,
  onDone,
}: {
  displayName: string;
  onDone: (s: Session) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Personal-only: there is nothing to choose, so the chooser step is
  // skipped entirely rather than shown with one option pre-selected — a
  // screen offering "a business" when business is not part of this release
  // is exactly the kind of business surface the flag exists to hide.
  const [step, setStep] = useState(BUSINESS_FEATURES_ENABLED ? 0 : 1);
  const [kindChoice, setKindChoice] = useState<Workspace>('business');
  const kind: Workspace = BUSINESS_FEATURES_ENABLED ? kindChoice : 'personal';
  const [name, setName] = useState('');
  const [abn, setAbn] = useState('');
  const [gstRegistered, setGstRegistered] = useState(true);
  const [gstBasis, setGstBasis] = useState<'cash' | 'accrual'>('cash');
  const [occupation, setOccupation] = useState('truckie_long');
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const business = kind === 'business';
  const abnDigits = abn.replace(/\D/g, '');
  const abnProblem = abnDigits.length > 0 && !abnIsValid(abnDigits);

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      onDone(
        await api().completeOnboarding({
          workspaceName: name.trim(),
          kind,
          abn: business ? abnDigits || null : null,
          gstRegistered: business ? gstRegistered : false,
          gstBasis,
          occupationProfileId: business ? occupation : null,
          monthlyBudget: business ? null : budget ? Number(budget).toFixed(4) : null,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set that up.');
      setBusy(false);
    }
  }

  const canAdvance =
    step === 0 ? true : step === 1 ? name.trim().length > 0 && !abnProblem : true;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress, so the steps read as a known, finite count. Personal-only
            drops the kind-picker step, so there are two dots, not three, and
            the first one showing is `step - 1` of them rather than `step`. */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {(BUSINESS_FEATURES_ENABLED ? [0, 1, 2] : [1, 2]).map((i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: i <= step ? p.accent : p.rule,
              }}
            />
          ))}
        </View>

        {step === 0 ? (
          <>
            <View style={{ gap: space.xs }}>
              <Small>Welcome, {displayName.split(' ')[0]}</Small>
              <Figure size="h1">What are you tracking?</Figure>
            </View>

            {(
              [
                {
                  value: 'business' as const,
                  title: 'A business',
                  detail:
                    'GST, tax invoices and a BAS position. Every receipt is checked against what the ATO requires before you can claim it.',
                },
                {
                  value: 'personal' as const,
                  title: 'Personal spending',
                  detail:
                    'Budgets and what is left this month. No GST, no ABN, no tax — because none of it applies to a household.',
                },
              ] as const
            ).map((option) => {
              const on = kind === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setKindChoice(option.value)}
                  style={{
                    borderRadius: radius.lg,
                    borderWidth: 2,
                    borderColor: on ? p.accent : p.rule,
                    backgroundColor: on ? p.accentSoft : 'transparent',
                    padding: space.lg,
                    gap: 4,
                  }}
                >
                  <Body strong>{option.title}</Body>
                  <Small>{option.detail}</Small>
                </Pressable>
              );
            })}

            <Small>
              You can add the other one later — they stay completely separate, with their own
              people and their own records.
            </Small>
          </>
        ) : step === 1 ? (
          <>
            <View style={{ gap: space.xs }}>
              {BUSINESS_FEATURES_ENABLED ? (
                <Label>Step 2 of 3</Label>
              ) : (
                <Small>Welcome, {displayName.split(' ')[0]}</Small>
              )}
              <Figure size="h1">{business ? 'Your business' : 'Your household'}</Figure>
            </View>

            <Raised style={{ gap: space.lg }}>
              <Field
                label={business ? 'Trading name' : 'Name'}
                value={name}
                onChangeText={setName}
                placeholder={business ? 'K. Marsh Transport' : 'Marsh Household'}
                autoFocus
              />
              {business ? (
                <Field
                  label="ABN"
                  value={abn}
                  onChangeText={setAbn}
                  keyboardType="number-pad"
                  placeholder="51 824 753 556"
                  hint={
                    abnProblem
                      ? 'That fails the ATO modulus-89 checksum — check the digits.'
                      : 'Optional now, but required on every tax invoice you issue.'
                  }
                />
              ) : null}
            </Raised>

            {business ? (
              <Raised style={{ gap: space.md }}>
                <Label>Occupation</Label>
                <Small>Decides which deduction rows the app offers you at tax time.</Small>
                <Choice value={occupation} onChange={setOccupation} options={OCCUPATIONS} />
              </Raised>
            ) : null}
          </>
        ) : (
          <>
            <View style={{ gap: space.xs }}>
              <Label>{BUSINESS_FEATURES_ENABLED ? 'Step 3 of 3' : 'Step 2 of 2'}</Label>
              <Figure size="h1">{business ? 'GST' : 'Monthly budget'}</Figure>
            </View>

            {business ? (
              <Raised style={{ gap: space.lg }}>
                <Toggle
                  label="Registered for GST"
                  hint="Required once turnover reaches $75,000 a year"
                  value={gstRegistered}
                  onChange={setGstRegistered}
                />
                {gstRegistered ? (
                  <>
                    <Choice
                      label="Accounting basis"
                      value={gstBasis}
                      onChange={setGstBasis}
                      options={[
                        { value: 'cash', label: 'Cash' },
                        { value: 'accrual', label: 'Accrual' },
                      ]}
                    />
                    <Small>
                      {gstBasis === 'cash'
                        ? 'Cash: GST counts in the quarter money changes hands. Most small businesses are on this.'
                        : 'Accrual: GST counts in the quarter the invoice is issued.'}
                    </Small>
                  </>
                ) : (
                  <Small>
                    Without GST registration the app still tracks spending and deductions, but
                    there is no BAS to prepare and no GST to claim back.
                  </Small>
                )}
              </Raised>
            ) : (
              <Raised style={{ gap: space.md }}>
                <Field
                  label="What do you want to spend each month?"
                  value={budget}
                  onChangeText={setBudget}
                  keyboardType="decimal-pad"
                  prefix="$"
                  autoFocus
                  hint="A single figure is enough to start. Split it by category whenever you like."
                />
              </Raised>
            )}

            {!business ? (
              <Small>
                Your account starts with 10 free scans — no card, no plan. Check Credits any time to
                see what is left.
              </Small>
            ) : null}

            {error ? (
              <View style={{ backgroundColor: p.riskSoft, borderRadius: radius.md, padding: space.md }}>
                <Small muted={false} style={{ color: p.risk }}>
                  {error}
                </Small>
              </View>
            ) : null}
          </>
        )}

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {step > (BUSINESS_FEATURES_ENABLED ? 0 : 1) ? (
            <Button
              label="Back"
              tone="outline"
              onPress={() => setStep(step - 1)}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            label={step === 2 ? 'Finish' : 'Continue'}
            onPress={() => (step === 2 ? void finish() : setStep(step + 1))}
            disabled={!canAdvance}
            busy={busy}
            style={{ flex: 2 }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
