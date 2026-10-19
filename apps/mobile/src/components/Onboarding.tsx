import { useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Session } from '@/api';
import { takePendingCountry } from '@/lib/pending-country';
import { Icon, type IconName } from '@/components/Icon';
import { Body, Button, Label, Notice, Screen, Small } from '@/components/ui';
import { numeric, radius, space, type, usePalette } from '@/theme';

/**
 * The first thing a new account sees, laid out in the instrument pass's
 * language: type and hairlines on the plain ground, one primary Button pinned
 * to the bottom of each step.
 *
 * Four steps, and the order is the prototype's: say what the app does, ask for
 * the camera, set up the first budgets, then hand over. The earlier build
 * asked business-or-personal first; that question is gone with
 * `BUSINESS_FEATURES_ENABLED` off, and the redesign does not bring it back.
 *
 * Two things are asked here that the prototype does not show, because the
 * server needs them and there is nowhere else to put them:
 *
 *   - the household's NAME, folded into step 0 rather than given a step of its
 *     own. `completeOnboarding` will not create a workspace without it.
 *   - nothing else. Occupation, GST and the ABN are business-side and do not
 *     apply; the old screen's fields for them are deleted rather than hidden.
 *
 * The category budgets in step 2 are written AFTER the workspace exists —
 * `setBudget` needs somewhere to write them to.
 */

const BULLETS: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'camera',
    title: 'One tap per receipt',
    body:
      'The shutter captures, fingerprints and files in one action. Multi-page invoices hold in a tray.',
  },
  {
    icon: 'shield',
    title: 'The original is the record',
    body:
      'Kept unmodified, never cropped or compressed, so the copy is one you can rely on.',
  },
  {
    icon: 'target',
    title: 'One number to watch',
    body: 'What is left this month, and what that means per day.',
  },
];

const READY = [
  'Ten scans included, free',
  'Nothing to set up on a computer',
  'Your records export whenever you want them',
];

type Draft = { name: string; amount: string };

const MAX_CATEGORIES = 5;

/** The step count the progress label and segments are drawn from. */
const STEPS = 4;

export function Onboarding({
  displayName,
  onDone,
}: {
  displayName: string;
  onDone: (s: Session) => void;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [household, setHousehold] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([{ name: '', amount: '' }]);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = drafts.filter((d) => d.name.trim() && Number(d.amount) > 0);
  const monthly = named.reduce((a, d) => a + Number(d.amount), 0);

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      /* The country picked at registration. Absent means no engine is
         installed, which is a real state the server models honestly — every
         tax figure then refuses rather than defaulting to Australian law. */
      const taxRulesId = await takePendingCountry();

      const session = await api().completeOnboarding({
        workspaceName: household.trim(),
        kind: 'personal',
        abn: null,
        gstRegistered: false,
        gstBasis: 'cash',
        occupationProfileId: null,
        monthlyBudget: monthly > 0 ? monthly.toFixed(4) : null,
        taxRulesId,
      });

      /* Now that there is a workspace, write the per-category budgets.
         Sequential, not `Promise.all`: each call returns the whole recomputed
         summary, and firing them together means the last write wins on a
         server that reads-modifies-writes. Three extra round trips at signup
         is a fair price for not losing two of five budgets. */
      for (const d of named) {
        try {
          await api().setBudget(d.name.trim(), Number(d.amount).toFixed(4));
        } catch {
          /* A budget that fails to save is recoverable from the Budgets
             screen; failing the whole signup over one is not. */
        }
      }
      onDone(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set that up.');
      setBusy(false);
    }
  }

  const canAdvance =
    step === 0 ? household.trim().length > 1 : step === 2 ? drafts.every(isUsable) : true;

  const cta = step === 3 ? 'Take your first receipt' : step === 2 && named.length === 0 ? 'Skip for now' : 'Continue';

  return (
    <Screen>
      {/* Progress: a mono "STEP n / total" and one hairline segment per step.
          Four steps, always — nothing is conditional now. */}
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: space.lg, gap: space.sm }}>
        <Label>
          Step {step + 1} / {STEPS}
        </Label>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {Array.from({ length: STEPS }, (_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 2,
                backgroundColor: i < step ? p.ink : i === step ? p.accent : p.rule,
              }}
            />
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: space.xl,
          paddingBottom: space.lg,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.sm }}>
          <Text style={[type.display, { color: p.ink }]}>
            {
              [
                `Welcome, ${displayName.split(' ')[0]}`,
                'Let it see a receipt',
                'What do you want to watch?',
                'You are set up',
              ][step]
            }
          </Text>
          <Text style={[type.body, { color: p.inkMuted, maxWidth: 330 }]}>
            {
              [
                'Photograph a receipt and it becomes a record you can rely on.',
                'Scanning needs the camera. Nothing is uploaded until you say so.',
                'Give a category a monthly allowance. You can change any of it later.',
                'Ten scans are already on your account.',
              ][step]
            }
          </Text>
        </View>

        {step === 0 ? (
          <View style={{ gap: space.xl }}>
            {/* Three statements as ledger rows: a hairline, a quiet outline
                glyph, the claim in bodyStrong. No tile, no card per item. */}
            <View>
              {BULLETS.map((b, i) => (
                <View
                  key={b.title}
                  style={{
                    flexDirection: 'row',
                    gap: 14,
                    paddingVertical: space.lg,
                    borderTopWidth: 1,
                    borderTopColor: p.rule,
                    borderBottomWidth: i === BULLETS.length - 1 ? 1 : 0,
                    borderBottomColor: p.rule,
                  }}
                >
                  <Icon name={b.icon} size={20} color={p.inkMuted} />
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={[type.bodyStrong, { color: p.ink }]}>{b.title}</Text>
                    <Small>{b.body}</Small>
                  </View>
                </View>
              ))}
            </View>
            <View style={{ gap: 6 }}>
              <Label>What should we call this?</Label>
              <OnbInput
                accessibilityLabel="Household name"
                value={household}
                onChangeText={setHousehold}
                placeholder="Marsh Household"
              />
              <Small>Only the people you invite ever see this.</Small>
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: space.lg }}>
            {/* The one dark panel on this step: a viewfinder drawn as a
                dashed frame, the picture of what the camera is about to do. */}
            <View
              style={{
                height: 196,
                borderRadius: radius.xxl,
                backgroundColor: p.void,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  top: 26,
                  bottom: 26,
                  left: 34,
                  right: 34,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: p.voidMuted,
                  borderRadius: radius.md,
                }}
              />
              <Icon name="camera" size={34} color={p.voidMuted} />
            </View>
            <Button
              label={permission?.granted ? 'Camera allowed' : 'Allow the camera'}
              icon={permission?.granted ? 'check' : 'camera'}
              tone={permission?.granted ? 'outline' : 'accent'}
              onPress={() => void requestPermission()}
            />
            <Small style={{ textAlign: 'center' }}>
              You can allow it later from Settings. Scanning won&rsquo;t work until you do.
            </Small>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ gap: space.lg }}>
            {drafts.map((d, i) => (
              <View
                key={i}
                style={{
                  gap: space.md,
                  paddingTop: i === 0 ? 0 : space.lg,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: p.rule,
                }}
              >
                <View style={{ gap: 6 }}>
                  <Label>Category {i + 1}</Label>
                  <OnbInput
                    accessibilityLabel={`Category ${i + 1} name`}
                    value={d.name}
                    onChangeText={(v) => setDrafts(patch(drafts, i, { name: v }))}
                    placeholder="Groceries"
                  />
                </View>
                <View style={{ gap: 6 }}>
                  <Label>Per month</Label>
                  <OnbInput
                    accessibilityLabel={`Category ${i + 1} monthly amount`}
                    value={d.amount}
                    onChangeText={(v) => setDrafts(patch(drafts, i, { amount: v.replace(/[^\d.]/g, '') }))}
                    placeholder="900"
                    keyboardType="decimal-pad"
                    invalid={!isUsable(d)}
                    mono
                  />
                </View>
                {drafts.length > 1 ? (
                  <Button
                    label="Remove"
                    tone="ghost"
                    onPress={() => setDrafts(drafts.filter((_, j) => j !== i))}
                  />
                ) : null}
              </View>
            ))}

            {drafts.length < MAX_CATEGORIES ? (
              <Button
                label="Create another budget"
                icon="plus"
                tone="outline"
                onPress={() => setDrafts([...drafts, { name: '', amount: '' }])}
              />
            ) : (
              <Small style={{ textAlign: 'center' }}>
                That&rsquo;s the five you can set up here. Add more from Budgets later.
              </Small>
            )}

            <Small>
              {named.length === 0
                ? 'Skip this if you would rather see what you actually spend first.'
                : `${named.length} ${named.length === 1 ? 'budget' : 'budgets'}, ${formatTotal(monthly)} a month.`}
            </Small>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={{ gap: space.xl }}>
            {/* A readout, not a gradient card: hairline, mono label, the
                figure set light. */}
            <View style={{ gap: space.xs, paddingTop: space.md, borderTopWidth: 1, borderTopColor: p.ruleStrong }}>
              <Label>Included</Label>
              <Text style={[type.hero, numeric, { color: p.ink }]}>10 scans</Text>
              <Text style={[type.body, { color: p.inkMuted }]}>Free, no card. Credits never expire.</Text>
            </View>
            <View>
              {READY.map((r, i) => (
                <View
                  key={r}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    minHeight: 48,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: p.rule,
                  }}
                >
                  <Icon name="check" size={16} color={p.ink} />
                  <Body>{r}</Body>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
      </ScrollView>

      {/* The step controls sit outside the scroll view so they never scroll
          away from someone who has already decided. One primary Button; Back
          is a ghost beneath it, so the way forward is the only loud thing. */}
      <View
        style={{
          gap: space.sm,
          padding: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          borderTopWidth: 1,
          borderTopColor: p.rule,
        }}
      >
        <Button
          label={cta}
          busy={busy}
          disabled={!canAdvance}
          onPress={() => (step === 3 ? void finish() : setStep(step + 1))}
        />
        {step > 0 ? <Button label="Back" tone="ghost" onPress={() => setStep(step - 1)} /> : null}
      </View>
    </Screen>
  );
}

/** A text input in the `Field` look, local because `Field` does not carry an
 *  accessibilityLabel and the label above it is not the one a screen reader
 *  announces ("Category 2 monthly amount"). */
function OnbInput({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  invalid,
  mono,
}: {
  accessibilityLabel: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad';
  invalid?: boolean;
  mono?: boolean;
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor={p.inkFaint}
      keyboardType={keyboardType}
      style={{
        minHeight: 50,
        borderWidth: focused ? 2 : 1,
        borderColor: invalid ? p.risk : focused ? p.accent : p.ruleStrong,
        borderRadius: radius.md,
        backgroundColor: p.ground,
        paddingHorizontal: focused ? 13 : 14,
        ...(mono ? { ...type.amount, fontSize: 16, ...numeric } : type.input),
        color: p.ink,
      }}
    />
  );
}

/** A row is usable when it is empty or complete — never half-filled. */
function isUsable(d: Draft): boolean {
  const blank = !d.name.trim() && !d.amount.trim();
  return blank || (d.name.trim().length > 0 && Number(d.amount) > 0);
}

function patch(list: Draft[], i: number, change: Partial<Draft>): Draft[] {
  return list.map((d, j) => (j === i ? { ...d, ...change } : d));
}

function formatTotal(n: number): string {
  return `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
}
