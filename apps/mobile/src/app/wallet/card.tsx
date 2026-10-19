import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type WalletProvider } from '@/api';
import { Icon } from '@/components/Icon';
import { Button, Label, Notice, Screen, ScreenHeader, Small } from '@/components/ui';
import { numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Entering a card, or linking a device wallet.
 *
 * The PAN and CVC typed here go straight into `addSavedCard` and are never
 * held anywhere else — not in a ref, not in a log line, not in the error
 * message if the call fails. `AddSavedCardRequest` in the contract says the
 * same thing from the other side.
 *
 * Validation is deliberately shallow: a Luhn check and a plausible expiry.
 * Anything stricter is the processor's job, and a client that rejects a valid
 * card because its own BIN table is out of date is worse than one that lets
 * the processor answer.
 *
 * The card drawn above the form is a preview of what is typed, in the void
 * colour like every other physical object in the app. It shows only the last
 * four digits — the same four `SavedCard.last4` keeps — so the preview never
 * puts a full PAN on screen.
 */
export default function AddCardScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ provider?: string; label?: string }>();
  const provider = (params.provider as WalletProvider) ?? 'card';
  const label = params.label ?? 'Card';

  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = number.replace(/\D/g, '');
  const numberBad = digits.length >= 12 && !luhn(digits);
  const exp = parseExpiry(expiry);
  const expiryBad = expiry.length >= 5 && !exp;
  const cvcBad = cvc.length > 0 && !/^\d{3,4}$/.test(cvc);

  const canSave =
    provider !== 'card' ||
    (name.trim().length > 1 && digits.length >= 12 && luhn(digits) && !!exp && /^\d{3,4}$/.test(cvc));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api().addSavedCard({
        provider,
        nameOnCard: provider === 'card' ? name.trim() : label,
        number: provider === 'card' ? digits : '',
        expiryMonth: exp?.month ?? 12,
        expiryYear: exp?.year ?? new Date().getFullYear() + 4,
        cvc: provider === 'card' ? cvc : '000',
      });
      // Straight back to the checkout that sent us here, not another push:
      // the card list reloads on focus and the new card is preselected.
      router.back();
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that card.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={label} onBack={() => router.back()} />

        {provider === 'card' ? (
          <>
            <CardObject
              network={label}
              last4={digits.length >= 4 ? digits.slice(-4) : null}
              name={name.trim()}
              expiry={expiry}
            />

            <View style={{ gap: space.lg }}>
              <Text style={[type.body, { color: p.inkMuted }]}>
                Enter the card you want charged. Nothing is taken until you complete a top up.
              </Text>

              <Input
                label="Name on card"
                value={name}
                onChangeText={setName}
                placeholder="Name on card"
                autoCapitalize="words"
              />

              <View style={{ gap: 6 }}>
                <Input
                  label="Card number"
                  value={number}
                  onChangeText={(v) => setNumber(groupDigits(v))}
                  placeholder="Card number"
                  keyboardType="number-pad"
                  maxLength={23}
                  mono
                  bad={numberBad}
                />
                {numberBad ? (
                  <Text style={[type.small, { color: p.risk }]}>
                    Check that number — it does not look right.
                  </Text>
                ) : null}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Input
                    label="Expiry"
                    value={expiry}
                    onChangeText={(v) => setExpiry(formatExpiry(v))}
                    placeholder="MM/YY"
                    keyboardType="number-pad"
                    maxLength={5}
                    mono
                    bad={expiryBad}
                  />
                  {expiryBad ? (
                    <Text style={[type.small, { color: p.risk }]}>Past, or not a month.</Text>
                  ) : null}
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Input
                    label="Security code"
                    shortLabel="CVC"
                    value={cvc}
                    onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
                    placeholder="CVC"
                    keyboardType="number-pad"
                    secureTextEntry
                    mono
                    bad={cvcBad}
                  />
                  {cvcBad ? (
                    <Text style={[type.small, { color: p.risk }]}>Three or four digits.</Text>
                  ) : null}
                </View>
              </View>

              {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

              <Button label="Save card" busy={busy} disabled={!canSave} onPress={() => void save()} />
              <Small>
                Snap Apps keeps the last four digits so you can tell your cards apart. The full
                number goes to the processor and is not stored here.
              </Small>
            </View>
          </>
        ) : (
          <View style={{ gap: space.lg }}>
            <Text style={[type.body, { color: p.inkMuted }]}>
              Snap Apps will use the card already set up on this device. There is nothing to type.
            </Text>
            <CardObject network={label} last4={null} name="" expiry="" onDevice />
            {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
            <Button label={`Link ${label}`} busy={busy} onPress={() => void save()} />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * A card as a physical object: the void colour, a hairline chip, the network
 * top-left in mono, the number and expiry in Plex Mono. Flat — no gradient,
 * no gloss, no shadow; it sits on the page like the void panel does.
 *
 * Takes plain strings only. `last4` is null until four digits exist, and a
 * device wallet passes `onDevice` instead of a number, because there is no
 * number to show and inventing one would be a lie.
 */
function CardObject({
  network,
  last4,
  name,
  expiry,
  onDevice,
}: {
  network: string;
  last4: string | null;
  name: string;
  expiry: string;
  onDevice?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={
        onDevice
          ? `${network}, confirmed on this device`
          : `${network} card${last4 ? `, ending ${last4}` : ''}`
      }
      style={{
        minHeight: 176,
        backgroundColor: p.void,
        borderRadius: radius.xxl,
        borderWidth: 1,
        borderColor: p.voidRule,
        padding: 20,
        justifyContent: 'space-between',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
        <Text style={[type.label, { color: p.voidMuted, flex: 1 }]} numberOfLines={1}>
          {network}
        </Text>
        {onDevice ? <Icon name="shield" size={20} color={p.voidMuted} /> : null}
      </View>

      {/* The chip: an outline with one hairline across it, nothing more. */}
      <View
        style={{
          width: 38,
          height: 28,
          borderRadius: 5,
          borderWidth: 1,
          borderColor: p.voidMuted,
          justifyContent: 'center',
        }}
      >
        <View style={{ height: 1, backgroundColor: p.voidRule }} />
      </View>

      <View style={{ gap: 10 }}>
        <Text style={[type.figure, numeric, { color: p.voidInk, letterSpacing: 1.5 }]}>
          {onDevice ? 'ON THIS DEVICE' : `•••• ${last4 ?? '••••'}`}
        </Text>
        {onDevice ? (
          <Text style={[type.mono, { color: p.voidMuted }]}>You confirm every charge on the device itself.</Text>
        ) : (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
            <Text style={[type.mono, { color: p.voidMuted, flex: 1, textTransform: 'uppercase' }]} numberOfLines={1}>
              {name || 'Name on card'}
            </Text>
            <Text style={[type.mono, numeric, { color: p.voidMuted }]}>{expiry || 'MM/YY'}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * A labelled input drawn like `Field` (mono label over a hairline box, 2px
 * accent edge on focus) but passing through what `Field` does not take: the
 * accessibility label, `maxLength`, and a risk edge when the value is bad.
 * Card entry needs all three, and the PAN field must stay a plain controlled
 * input with no logging or mirroring.
 */
function Input({
  label,
  shortLabel,
  bad,
  mono,
  ...rest
}: TextInputProps & { label: string; shortLabel?: string; bad?: boolean; mono?: boolean }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{shortLabel ?? label}</Label>
      <View
        style={{
          minHeight: 50,
          justifyContent: 'center',
          // 1px at rest, 2px focused; the pixel comes out of the padding so the
          // text does not shift when focus lands.
          borderWidth: focused || bad ? 2 : 1,
          borderColor: bad ? p.risk : focused ? p.accent : p.ruleStrong,
          backgroundColor: p.ground,
          borderRadius: radius.md,
          paddingHorizontal: focused || bad ? 13 : 14,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={p.inkFaint}
          autoCorrect={false}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            mono ? [type.amount, { fontSize: 16 }, numeric] : type.input,
            { color: p.ink, paddingVertical: 12 },
          ]}
        />
      </View>
    </View>
  );
}

/** Groups into fours as you type, so the number stays readable. */
function groupDigits(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 19);
  return d.replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** `MM/YY` to real numbers, or null when it is not a future month. */
function parseExpiry(v: string): { month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(v);
  if (!m) return null;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return null;
  const now = new Date();
  // A card is good through the LAST day of its expiry month.
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  return endOfMonth < now ? null : { month, year };
}

/** The standard mod-10 check. Catches a mistyped digit, nothing more. */
function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}
