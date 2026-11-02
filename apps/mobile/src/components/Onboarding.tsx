import { useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Session } from '@/api';
import { currencyDecimals, formatMoney } from '@/lib/format';
import { peekPendingCurrency, takePendingCountry } from '@/lib/pending-country';
import { Icon, type IconName } from '@/components/Icon';
import { GradientHero } from '@/components/rich';
import {
  Body,
  Button,
  Card,
  IconTile,
  Notice,
  Screen,
  Small,
  Title,
} from '@/components/ui';
import { control, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * The first thing a new account sees, rebuilt against the 2026-09-19
 * prototype.
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
  const [focus, setFocus] = useState<string | null>(null);
  // The workspace does not exist yet, so its currency is the one picked at sign-up.
  const [currency, setCurrency] = useState<string>('AUD');
  useEffect(() => {
    void peekPendingCurrency().then((c) => c && setCurrency(c));
  }, []);
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
      {/* Progress. Four steps, always — nothing is conditional now. A
          segmented bar with a plain "Step n of 4" under it: the bar shows how
          far, the words say how many, and neither needs decoding. */}
      <View
        accessible
        accessibilityLabel={`Step ${step + 1} of 4`}
        style={{
          gap: space.sm,
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.gutter,
        }}
      >
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= step ? p.accent : p.rule }}
            />
          ))}
        </View>
        <Small>Step {step + 1} of 4</Small>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: space.xl,
          paddingBottom: space.lg,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Title level="h1" style={{ textAlign: 'center' }}>
            {
              [
                `Welcome, ${displayName.split(' ')[0]}`,
                'Let it see a receipt',
                'What do you want to watch?',
                'You are set up',
              ][step]
            }
          </Title>
          <Text style={[type.body, { color: p.inkMuted, textAlign: 'center', maxWidth: 330 }]}>
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
          <View style={{ gap: space.md }}>
            {BULLETS.map((b) => (
              <Card key={b.title} style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
                <IconTile name={b.icon} size={40} />
                <View style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                  <Body strong>{b.title}</Body>
                  <Small>{b.body}</Small>
                </View>
              </Card>
            ))}
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Text style={[type.label, { color: p.inkMuted }]}>What should we call this?</Text>
              <TextInput
                accessibilityLabel="Household name"
                onFocus={() => setFocus('household')}
                onBlur={() => setFocus(null)}
                value={household}
                onChangeText={setHousehold}
                placeholder="Marsh Household"
                placeholderTextColor={p.inkFaint}
                style={{
                  // White fill, 1px edge, accent when focused.
                  minHeight: control.input,
                  borderWidth: 1,
                  borderColor: focus === 'household' ? p.accent : p.ruleStrong,
                  borderRadius: radius.lg,
                  backgroundColor: p.card,
                  paddingHorizontal: space.lg,
                  ...type.input,
                  color: p.ink,
                }}
              />
              <Small>Only the people you invite ever see this.</Small>
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={{ gap: space.lg }}>
            <View
              style={{
                height: 196,
                borderRadius: radius.xl,
                backgroundColor: '#101418',
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
                  borderWidth: 2,
                  borderStyle: 'dashed',
                  borderColor: 'rgba(255,255,255,0.8)',
                  borderRadius: radius.lg,
                }}
              />
              <Icon name="camera" size={38} color="rgba(255,255,255,0.62)" />
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
          <View style={{ gap: space.md }}>
            {drafts.map((d, i) => (
              <Card key={i} style={{ gap: space.md, padding: space.lg }}>
                <TextInput
                  accessibilityLabel={`Category ${i + 1} name`}
                  onFocus={() => setFocus(`name${i}`)}
                  onBlur={() => setFocus(null)}
                  value={d.name}
                  onChangeText={(v) => setDrafts(patch(drafts, i, { name: v }))}
                  placeholder="Groceries"
                  placeholderTextColor={p.inkFaint}
                  style={{
                    minHeight: control.input,
                    borderWidth: 1,
                    borderColor: focus === `name${i}` ? p.accent : p.ruleStrong,
                    borderRadius: radius.lg,
                    backgroundColor: p.card,
                    paddingHorizontal: space.lg,
                    ...type.input,
                    color: p.ink,
                  }}
                />
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.sm,
                    minHeight: control.amount,
                    borderWidth: 1,
                    borderColor: !isUsable(d) ? p.risk : focus === `amount${i}` ? p.accent : p.ruleStrong,
                    borderRadius: radius.lg,
                    backgroundColor: p.card,
                    paddingHorizontal: space.lg,
                  }}
                >
                  <Icon name="wallet" size={22} color={p.inkMuted} />
                  <TextInput
                    accessibilityLabel={`Category ${i + 1} monthly amount`}
                    onFocus={() => setFocus(`amount${i}`)}
                    onBlur={() => setFocus(null)}
                    value={d.amount}
                    onChangeText={(v) => setDrafts(patch(drafts, i, { amount: v.replace(/[^\d.]/g, '') }))}
                    placeholder={currencyDecimals(currency) === 0 ? '1000000' : '900'}
                    placeholderTextColor={p.inkFaint}
                    keyboardType="decimal-pad"
                    style={{ flex: 1, minWidth: 0, ...type.figure, ...numeric, color: p.ink }}
                  />
                  <Small>per month</Small>
                </View>
                {drafts.length > 1 ? (
                  <Button
                    label="Remove"
                    tone="ghost"
                    onPress={() => setDrafts(drafts.filter((_, j) => j !== i))}
                  />
                ) : null}
              </Card>
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
                : `${named.length} ${named.length === 1 ? 'budget' : 'budgets'}, ${formatMoney(String(monthly), currency, { cents: false })} a month.`}
            </Small>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={{ gap: space.lg }}>
            <GradientHero>
              <Text style={[type.label, { color: 'rgba(255,255,255,0.95)' }]}>Included</Text>
              <Text style={[type.hero, numeric, { color: '#FFFFFF', marginTop: space.sm }]}>10 scans</Text>
              <Text style={[type.body, { color: 'rgba(255,255,255,0.95)', marginTop: space.sm }]}>
                Free, no card. Credits never expire.
              </Text>
            </GradientHero>
            <View style={{ gap: space.md }}>
              {READY.map((r) => (
                <View key={r} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: p.goodSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="check" size={14} color={p.good} />
                  </View>
                  <Body>{r}</Body>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
      </ScrollView>

      {/* The step controls sit outside the scroll view so they never scroll
          away from someone who has already decided. One primary button, wider
          than the Back beside it; no divider, the ground carries on. */}
      <View
        style={{
          flexDirection: 'row',
          gap: space.md,
          paddingHorizontal: space.gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.lg,
        }}
      >
        {step > 0 ? (
          <Button label="Back" tone="outline" style={{ flex: 1 }} onPress={() => setStep(step - 1)} />
        ) : null}
        <Button
          label={cta}
          style={{ flex: 2 }}
          busy={busy}
          disabled={!canAdvance}
          onPress={() => (step === 3 ? void finish() : setStep(step + 1))}
        />
      </View>
    </Screen>
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
