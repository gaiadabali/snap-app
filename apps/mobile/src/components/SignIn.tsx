import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AuthUser, type AvailableTaxRules, type Session } from '@/api';
import { Icon } from '@/components/Icon';
import { Avatar } from '@/components/form';
import { GradientHero, HeroBody, HeroLabel } from '@/components/rich';
import {
  Body,
  Button,
  Card,
  DividerLabel,
  IconButton,
  Notice,
  Screen,
  Small,
  Title,
} from '@/components/ui';
import { control, radius, space, type, usePalette } from '@/theme';

/**
 * Everything before there is a session, rebuilt against the 2026-09-19
 * prototype: choose, register, log in, forgot, and the six-digit code.
 *
 * Held as ONE component with a `step` rather than five routes. The prototype
 * treats them as routes, but `SessionGate` renders this whole tree instead of
 * the app — there is no router mounted yet — and the flow is a stack of at
 * most three, all sharing an email. A state machine says that; five files
 * pretending to be independent destinations would not.
 *
 * The demo accounts stay. The point of building identity was to make roles
 * real, and a presenter needs to become a Staff member in one tap to show
 * that they cannot post to the ledger.
 */
type Step = 'choose' | 'register' | 'login' | 'forgot' | 'otp' | 'reset';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('choose');
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  const [countries, setCountries] = useState<AvailableTaxRules[]>([]);

  // One email across the whole flow — it is the same person the entire time.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [country, setCountry] = useState<AvailableTaxRules | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void api().listDemoAccounts().then(setAccounts).catch(() => {});
    /* Expected to 401 before sign-in — see the note by <CountryPicker>. The
       catch is the normal path, not an error case, so nothing is surfaced. */
    void api().listAvailableTaxRules().then(setCountries).catch(() => setCountries([]));
  }, []);

  function go(next: Step) {
    setError(null);
    setNote(null);
    setStep(next);
  }

  async function run(key: string, work: () => Promise<Session | null>) {
    setError(null);
    setBusy(key);
    try {
      const session = await work();
      if (session) onSignedIn(session);
      return session;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  const address = email.trim().toLowerCase();
  const emailOk = EMAIL.test(address);
  // Mirrors MIN_PASSWORD_LENGTH in apps/server/src/auth/passwords.ts, and
  // counts code points the same way — five emoji are five characters to the
  // person typing them and ten to `String.length`.
  const pwOk = [...password].length >= 10;

  const pad = {
    padding: 20,
    paddingTop: insets.top + space.md,
    paddingBottom: insets.bottom + space.xxl,
    gap: 14,
  };

  /* ── Choose ─────────────────────────────────────────────────────────── */
  if (step === 'choose') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ ...pad, gap: 16 }} keyboardShouldPersistTaps="handled">
          <GradientHero>
            <View style={{ gap: space.sm }}>
              <HeroLabel>Snap Apps</HeroLabel>
              <Text style={{ ...type.h1, color: '#FFFFFF' }}>Receipts into records</Text>
              <HeroBody>
                Photograph a receipt, check what was read, keep a record that holds up.
              </HeroBody>
            </View>
          </GradientHero>

          <Card style={{ gap: 11, padding: 18 }}>
            <AuthInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              invalid={email.length > 0 && !emailOk}
            />
            <Button
              label="Continue"
              onPress={() => go(accounts.length ? 'login' : 'register')}
              disabled={!emailOk}
            />
            <Small>
              {email.length > 0 && !emailOk
                ? 'That does not look like an email address.'
                : "An address we don't recognise creates a new account."}
            </Small>
          </Card>

          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

          {accounts.length > 0 ? (
            <>
              <DividerLabel>or continue as</DividerLabel>
              <Card padded={false}>
                {accounts.map((a, i) => (
                  <Pressable
                    key={a.userId}
                    accessibilityRole="button"
                    accessibilityLabel={`Continue as ${a.displayName}`}
                    onPress={() => void run(a.email, () => api().signIn(a.email))}
                    style={({ pressed }) => ({
                      minHeight: 64,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 14,
                      paddingHorizontal: 18,
                      paddingVertical: space.md,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: p.rule,
                      backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                      opacity: busy && busy !== a.email ? 0.5 : 1,
                    })}
                  >
                    <Avatar initials={a.initials} size={42} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Body strong>{a.displayName}</Body>
                      <Small numberOfLines={1}>{a.email}</Small>
                    </View>
                    {busy === a.email ? (
                      <Small>Signing in…</Small>
                    ) : (
                      <Icon name="chevronRight" size={18} color={p.inkMuted} />
                    )}
                  </Pressable>
                ))}
              </Card>
              <Small style={{ textAlign: 'center' }}>
                Each one has a different role, so the app behaves differently. Dan is Staff: he
                can scan and correct, but cannot post anything to the ledger.
              </Small>
            </>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  /* ── Register ───────────────────────────────────────────────────────── */
  if (step === 'register') {
    const canSubmit = name.trim().length > 1 && emailOk && pwOk && agreed;
    return (
      <Screen>
        <ScrollView contentContainerStyle={pad} keyboardShouldPersistTaps="handled">
          <AuthHeader title="Create your account">
            Your receipts and budgets stay tied to this account, on any phone you sign in from.
          </AuthHeader>

          <AuthInput label="Full name" value={name} onChangeText={setName} placeholder="Kira Marsh" />
          <AuthInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            invalid={email.length > 0 && !emailOk}
            error={email.length > 0 && !emailOk ? 'Enter a valid email address.' : undefined}
          />
          <PasswordInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Create a password"
            shown={showPw}
            onToggle={() => setShowPw((v) => !v)}
            error={password.length > 0 && !pwOk ? 'Use at least ten characters.' : undefined}
          />
          {/* Only when the catalogue actually answered.
              `/v1/tax-rules-catalogue` sits behind `SessionGuard`, so an
              unauthenticated caller gets a 401 and this list stays empty —
              which is the NORMAL case here, since registering is by
              definition something you do before you have a session. In
              production this picker therefore does not appear at all.

              It is kept rather than deleted because the prototype puts the
              question here and the endpoint only needs its guard relaxed to
              catalogue-public (it exposes rule-set ids, country names,
              versions and currencies — no tenant data) for it to work.

              Either way the answer is NOT required to create an account, and
              nothing yet persists it: installing a rule set per workspace
              belongs to the tax-rules work, not to this screen. Requiring it
              here disabled "Create account" outright in production. */}
          {countries.length > 0 ? (
            <CountryPicker options={countries} value={country} onChange={setCountry} />
          ) : null}

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            onPress={() => setAgreed((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: control.tap }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                borderWidth: 1.5,
                borderColor: agreed ? p.accent : p.ruleStrong,
                backgroundColor: agreed ? p.accent : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {agreed ? <Icon name="check" size={16} color="#FFFFFF" /> : null}
            </View>
            <Text style={[type.small, { flex: 1, color: p.inkStrong }]}>
              I agree to the terms of use and the privacy policy.
            </Text>
          </Pressable>

          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

          <Button
            label="Create account"
            busy={busy === 'register'}
            disabled={!canSubmit}
            onPress={() =>
              void run('register', () => api().register(address, password, name.trim()))
            }
          />

          <SocialRow onUnavailable={setNote} />
          {note ? <Notice tone="info" icon="info">{note}</Notice> : null}

          <FootLink prompt="Already have an account?" action="Log in" onPress={() => go('login')} />
        </ScrollView>
      </Screen>
    );
  }

  /* ── Log in ─────────────────────────────────────────────────────────── */
  if (step === 'login') {
    return (
      <Screen>
        <ScrollView contentContainerStyle={pad} keyboardShouldPersistTaps="handled">
          <AuthHeader title="Welcome back">Sign in to pick up where you left off.</AuthHeader>

          <AuthInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            invalid={email.length > 0 && !emailOk}
            error={email.length > 0 && !emailOk ? 'Enter a valid email address.' : undefined}
          />
          <PasswordInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            shown={showPw}
            onToggle={() => setShowPw((v) => !v)}
          />

          <Pressable
            accessibilityRole="button"
            onPress={() => go('forgot')}
            style={{ alignSelf: 'flex-start', minHeight: control.tap, justifyContent: 'center' }}
          >
            <Text style={[type.bodyStrong, { color: p.accentText, fontSize: 14 }]}>
              Forgot your password?
            </Text>
          </Pressable>

          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

          <Button
            label="Log in"
            busy={busy === 'login'}
            disabled={!emailOk || password.length === 0}
            onPress={() =>
              void run('login', () => api().signInWithPassword(address, password))
            }
          />

          <SocialRow onUnavailable={setNote} />
          {note ? <Notice tone="info" icon="info">{note}</Notice> : null}

          <FootLink
            prompt="New here?"
            action="Create an account"
            onPress={() => go('register')}
          />
        </ScrollView>
      </Screen>
    );
  }

  /* ── Forgot ─────────────────────────────────────────────────────────── */
  if (step === 'forgot') {
    return (
      <Screen>
        <BackBar onPress={() => go('login')} />
        <ScrollView contentContainerStyle={{ ...pad, paddingTop: 4 }} keyboardShouldPersistTaps="handled">
          <AuthHeader title="Reset your password">
            Give us the email on your account. We send a six-digit code to it.
          </AuthHeader>
          <AuthInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            invalid={email.length > 0 && !emailOk}
            error={email.length > 0 && !emailOk ? 'Enter a valid email address.' : undefined}
          />
          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
          <Button
            label="Send the code"
            busy={busy === 'otp-request'}
            disabled={!emailOk}
            onPress={() =>
              void (async () => {
                setBusy('otp-request');
                setError(null);
                try {
                  const res = await api().requestOtp({ email: address, purpose: 'reset-password' });
                  setNote(`We sent six digits to ${res.maskedTarget}.`);
                  setCode('');
                  setStep('otp');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not send a code.');
                } finally {
                  setBusy(null);
                }
              })()
            }
          />
        </ScrollView>
      </Screen>
    );
  }

  /* ── New password ───────────────────────────────────────────────────── */
  if (step === 'reset') {
    return (
      <Screen>
        <BackBar onPress={() => go('login')} />
        <ScrollView contentContainerStyle={{ ...pad, paddingTop: 4 }} keyboardShouldPersistTaps="handled">
          <AuthHeader title="Choose a new password">
            That code checked out. Pick something you have not used here before.
          </AuthHeader>
          <PasswordInput
            label="New password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least ten characters"
            shown={showPw}
            onToggle={() => setShowPw((v) => !v)}
            error={password.length > 0 && !pwOk ? 'Use at least ten characters.' : undefined}
          />
          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}
          <Button
            label="Save and sign in"
            busy={busy === 'reset'}
            disabled={!pwOk}
            onPress={() =>
              void run('reset', () =>
                api().resetPassword({ email: address, code, newPassword: password }),
              )
            }
          />
        </ScrollView>
      </Screen>
    );
  }

  /* ── Code ───────────────────────────────────────────────────────────── */
  return (
    <Screen>
      <BackBar onPress={() => go('forgot')} />
      <ScrollView contentContainerStyle={{ ...pad, paddingTop: 4, gap: 16 }} keyboardShouldPersistTaps="handled">
        <AuthHeader title="Enter the code">
          {note ?? `We sent six digits to ${address}.`} It is good for ten minutes.
        </AuthHeader>

        <CodeInput value={code} onChange={setCode} invalid={!!error} />

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Button
          label="Verify"
          busy={busy === 'otp-verify'}
          disabled={code.length !== 6}
          onPress={() =>
            void (async () => {
              setBusy('otp-verify');
              setError(null);
              try {
                await api().verifyOtp({ email: address, code, purpose: 'reset-password' });
                // A reset returns no session by design — the password still
                // has to be set before there is anything to sign in with.
                setPassword('');
                setNote(null);
                setStep('reset');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That code is not right.');
              } finally {
                setBusy(null);
              }
            })()
          }
        />

        <Resend
          onResend={() =>
            void api().requestOtp({ email: address, purpose: 'reset-password' }).catch(() => {})
          }
        />
      </ScrollView>
    </Screen>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function AuthHeader({ title, children }: { title: string; children: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: 7, paddingTop: space.md, paddingBottom: space.xs }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 18,
          backgroundColor: p.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.xs,
        }}
      >
        <Icon name="scan" size={30} color={p.accentText} />
      </View>
      <Title level="h1" style={{ textAlign: 'center' }}>
        {title}
      </Title>
      <Text style={[type.body, { color: p.inkMuted, textAlign: 'center', maxWidth: 320 }]}>
        {children}
      </Text>
    </View>
  );
}

function BackBar({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.md }}>
      <IconButton name="back" label="Back" onPress={onPress} />
    </View>
  );
}

function AuthInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  invalid,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address';
  invalid?: boolean;
  error?: string;
}) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.inkFaint}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoComplete={keyboardType === 'email-address' ? 'email' : 'name'}
        style={{
          minHeight: control.input,
          borderWidth: 1.5,
          borderColor: invalid ? p.risk : p.rule,
          borderRadius: radius.md,
          backgroundColor: p.surface,
          paddingHorizontal: space.lg,
          ...type.input,
          color: p.ink,
        }}
      />
      {error ? <Text style={[type.small, { color: p.risk }]}>{error}</Text> : null}
    </View>
  );
}

function PasswordInput({
  label,
  value,
  onChangeText,
  placeholder,
  shown,
  onToggle,
  error,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  shown: boolean;
  onToggle: () => void;
  error?: string;
}) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: control.input,
          borderWidth: 1.5,
          borderColor: error ? p.risk : p.rule,
          borderRadius: radius.md,
          backgroundColor: p.surface,
          paddingLeft: space.lg,
          paddingRight: 6,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.inkFaint}
          secureTextEntry={!shown}
          autoCapitalize="none"
          style={{ flex: 1, minWidth: 0, ...type.input, color: p.ink }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          onPress={onToggle}
          style={{ minHeight: control.tap, paddingHorizontal: space.md, justifyContent: 'center' }}
        >
          <Text style={[type.smallStrong, { color: p.accentText }]}>{shown ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      {error ? <Text style={[type.small, { color: p.risk }]}>{error}</Text> : null}
    </View>
  );
}

/**
 * Which country's rules the account runs on, and therefore which currency
 * every amount is shown in. Backed by the installed tax rule sets rather than
 * a hardcoded list — a deployment that has not installed Indonesia should not
 * offer it.
 */
function CountryPicker({
  options,
  value,
  onChange,
}: {
  options: AvailableTaxRules[];
  value: AvailableTaxRules | null;
  onChange: (v: AvailableTaxRules) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6, zIndex: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Country"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: control.input,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          borderWidth: 1.5,
          borderColor: p.rule,
          borderRadius: radius.md,
          backgroundColor: p.surface,
          paddingHorizontal: space.lg,
        }}
      >
        <Text
          style={[type.input, { flex: 1, color: value ? p.ink : p.inkFaint }]}
          numberOfLines={1}
        >
          {value?.countryName ?? 'Where do you live?'}
        </Text>
        {value ? <Text style={[type.small, { color: p.inkMuted }]}>{value.currency}</Text> : null}
        <Icon name="chevronDown" size={16} color={p.inkMuted} />
      </Pressable>

      {open ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: p.ruleStrong,
            borderRadius: radius.lg,
            backgroundColor: p.ground,
            padding: 6,
          }}
        >
          {options.map((o) => (
            <Pressable
              key={o.rulesId}
              accessibilityRole="button"
              onPress={() => {
                onChange(o);
                setOpen(false);
              }}
              style={({ pressed }) => ({
                minHeight: control.tap,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
                paddingHorizontal: space.md,
                borderRadius: 9,
                backgroundColor: pressed ? p.surfaceAlt : 'transparent',
              })}
            >
              <Text style={[type.body, { flex: 1, color: p.ink }]}>{o.countryName}</Text>
              <Text style={[type.small, { color: p.inkMuted }]}>{o.currency}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Small>Sets the currency every amount is shown in.</Small>
    </View>
  );
}

/**
 * Google and Apple, as the prototype lays them out.
 *
 * Neither is connected — the server delegates to its own identity provider and
 * no OAuth client is configured. They say so when pressed rather than
 * pretending to work, because a button that silently does nothing reads as a
 * bug and a button that fakes a sign-in is worse.
 */
function SocialRow({ onUnavailable }: { onUnavailable: (msg: string) => void }) {
  const p = usePalette();
  const box = {
    flex: 1,
    minHeight: control.button,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: space.sm,
    borderWidth: 1.5,
    borderColor: p.ruleStrong,
    borderRadius: radius.md,
    backgroundColor: p.surface,
  };
  return (
    <>
      <DividerLabel>or continue with</DividerLabel>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          style={box}
          onPress={() => onUnavailable('Google sign-in is not connected yet. Use your email address.')}
        >
          <Text style={[type.bodyStrong, { color: p.ink, fontSize: 14 }]}>Google</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={box}
          onPress={() => onUnavailable('Apple sign-in is not connected yet. Use your email address.')}
        >
          <Text style={[type.bodyStrong, { color: p.ink, fontSize: 14 }]}>Apple</Text>
        </Pressable>
      </View>
    </>
  );
}

function FootLink({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: control.tap, justifyContent: 'center' }}
    >
      <Text style={[type.body, { color: p.inkMuted, textAlign: 'center' }]}>
        {prompt} <Text style={{ fontWeight: '600', color: p.accentText }}>{action}</Text>
      </Text>
    </Pressable>
  );
}

/**
 * Six boxes with one real field behind them.
 *
 * The boxes are decoration: a transparent `TextInput` covers the row so the
 * keyboard, paste and SMS autofill all behave normally. Six separate fields
 * would break one-tap autofill, which is the only way most people enter these.
 */
function CodeInput({
  value,
  onChange,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  const p = usePalette();
  const cells = [0, 1, 2, 3, 4, 5];
  return (
    <View style={{ position: 'relative' }}>
      <View style={{ flexDirection: 'row', gap: space.sm }} pointerEvents="none">
        {cells.map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 60,
              borderWidth: 1.5,
              borderColor: invalid ? p.risk : value.length === i ? p.accent : p.rule,
              borderRadius: radius.md,
              backgroundColor: p.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 24, lineHeight: 30, fontWeight: '700', color: p.ink }}>
              {value[i] ?? ''}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel="Six-digit code"
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 60,
          opacity: 0,
        }}
      />
    </View>
  );
}

/** "Resend in 0:30", then a live button. */
function Resend({ onResend }: { onResend: () => void }) {
  const p = usePalette();
  const [left, setLeft] = useState(30);
  useEffect(() => {
    if (left <= 0) return undefined;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={[type.body, { color: p.inkMuted }]}>Didn&rsquo;t get it?</Text>
      {left > 0 ? (
        <Text style={[type.bodyStrong, { color: p.inkMuted, paddingHorizontal: space.xs }]}>
          {' '}
          Resend in 0:{String(left).padStart(2, '0')}
        </Text>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onResend();
            setLeft(30);
          }}
          style={{ minHeight: control.tap, justifyContent: 'center', paddingHorizontal: space.xs }}
        >
          <Text style={[type.bodyStrong, { color: p.accentText }]}> Resend</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * The splash, shown while the stored session is being read.
 *
 * Full-bleed brand blue with the mark assembling out of quadrants, which is
 * the prototype's one piece of real choreography. It is also honest: this
 * screen exists because reading the token off disk takes a moment, and a
 * wordmark that is doing something reads as loading where a static one reads
 * as stuck.
 */
export function SessionLoading() {
  const fade = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 620,
        easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 620,
        delay: 120,
        easing: Easing.bezier(0.22, 0.61, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, rise]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#1878D8',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -100,
          right: -80,
          width: 300,
          height: 300,
          borderRadius: 150,
          backgroundColor: 'rgba(255,255,255,0.10)',
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: -120,
          left: -90,
          width: 280,
          height: 280,
          borderRadius: 140,
          backgroundColor: 'rgba(255,255,255,0.07)',
        }}
      />
      <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }], alignItems: 'center' }}>
        <Icon name="scan" size={96} color="#FFFFFF" />
        <Text
          style={{
            fontSize: 34,
            lineHeight: 40,
            fontWeight: '700',
            color: '#FFFFFF',
            letterSpacing: -0.7,
            marginTop: 26,
          }}
        >
          Snap Apps
        </Text>
        <Text style={{ ...type.input, color: 'rgba(255,255,255,0.87)', marginTop: space.sm }}>
          Receipts into records
        </Text>
      </Animated.View>
    </View>
  );
}
