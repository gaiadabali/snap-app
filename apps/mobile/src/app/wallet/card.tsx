import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type WalletProvider } from '@/api';
import { Icon } from '@/components/Icon';
import { Body, Button, Notice, Screen, ScreenHeader, Small } from '@/components/ui';
import { control, numeric, radius, space, type, usePalette } from '@/theme';

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

  const field = {
    minHeight: control.input,
    borderWidth: 1.5,
    borderRadius: radius.md,
    backgroundColor: p.surface,
    paddingHorizontal: space.lg,
    ...type.input,
    color: p.ink,
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader title={label} onBack={() => router.back()} />

        {provider === 'card' ? (
          <View style={{ gap: space.md }}>
            <Text style={[type.body, { color: p.inkMuted }]}>
              Enter the card you want charged. Nothing is taken until you complete a top up.
            </Text>

            <TextInput
              accessibilityLabel="Name on card"
              value={name}
              onChangeText={setName}
              placeholder="Name on card"
              placeholderTextColor={p.inkFaint}
              autoCapitalize="words"
              style={{ ...field, borderColor: p.rule }}
            />

            <View style={{ gap: 6 }}>
              <TextInput
                accessibilityLabel="Card number"
                value={number}
                onChangeText={(v) => setNumber(groupDigits(v))}
                placeholder="Card number"
                placeholderTextColor={p.inkFaint}
                keyboardType="number-pad"
                maxLength={23}
                style={{ ...field, ...numeric, borderColor: numberBad ? p.risk : p.rule }}
              />
              {numberBad ? (
                <Text style={[type.small, { color: p.risk }]}>
                  Check that number — it does not look right.
                </Text>
              ) : null}
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput
                  accessibilityLabel="Expiry"
                  value={expiry}
                  onChangeText={(v) => setExpiry(formatExpiry(v))}
                  placeholder="MM/YY"
                  placeholderTextColor={p.inkFaint}
                  keyboardType="number-pad"
                  maxLength={5}
                  style={{ ...field, ...numeric, borderColor: expiryBad ? p.risk : p.rule }}
                />
                {expiryBad ? (
                  <Text style={[type.small, { color: p.risk }]}>Past, or not a month.</Text>
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <TextInput
                  accessibilityLabel="Security code"
                  value={cvc}
                  onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="CVC"
                  placeholderTextColor={p.inkFaint}
                  keyboardType="number-pad"
                  secureTextEntry
                  style={{ ...field, ...numeric, borderColor: cvcBad ? p.risk : p.rule }}
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
        ) : (
          <View style={{ gap: 14 }}>
            <Text style={[type.body, { color: p.inkMuted }]}>
              Snap Apps will use the card already set up on this device. There is nothing to type.
            </Text>
            <View
              style={{
                backgroundColor: p.goodSoft,
                borderRadius: radius.xl,
                padding: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 13,
              }}
            >
              <Icon name="shield" size={22} color={p.good} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Body strong style={{ color: p.goodInk }}>
                  {label}
                </Body>
                <Text style={[type.small, { color: p.goodInk }]}>
                  You confirm every charge on the device itself.
                </Text>
              </View>
            </View>
            {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
            <Button label={`Link ${label}`} busy={busy} onPress={() => void save()} />
          </View>
        )}
      </ScrollView>
    </Screen>
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
