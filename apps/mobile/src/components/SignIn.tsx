import { Fragment, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ApiError, type AuthUser, type AvailableTaxRules, type Session } from '@/api';
import { BrandLockup } from '@/components/BrandLogo';
import splashGlyph from '../../assets/splash-icon.png';
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
import { YourtalSignInButtons } from '@/components/YourtalSignInButtons';
import { CountryPicker } from '@/components/CountryPicker';
import { defaultCountry } from '@/lib/default-country';
import { rememberCountry } from '@/lib/pending-country';
import { isUseYourtal, showEmailForm, SIGNIN_COPY } from '@/lib/yourtal-signin';
import { brandFace, control, radius, space, type, usePalette } from '@/theme';

/**
 * Everything before there is a session, rebuilt against the 2026-09-19
 * prototype: choose, register, log in, and forgot (which mails a reset link;
 * the prototype's six-digit code step was replaced by the link, task 1.2.a).
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
type Step = 'choose' | 'register' | 'login' | 'forgot';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SignIn({
  onSignedIn,
  notice = null,
}: {
  onSignedIn: (s: Session) => void;
  /** Why the person is here again — a session that ended. Shown first. */
  notice?: string | null;
}) {
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
  // The address a reset link was last requested for, so the screen can say
  // "sent" — and stop saying it the moment the address is edited.
  const [sentTo, setSentTo] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Does the server offer YourTal? null until the answer arrives. False (or a failed ask) opens the email form,
  // so the screen is never left without a way in.
  const [yourtal, setYourtal] = useState<boolean | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    void api().listDemoAccounts().then(setAccounts).catch(() => {});
    void api()
      .listAvailableTaxRules()
      .then((options) => {
        setCountries(options);
        // Pre-chosen from the phone's region (Australia when it says nothing
        // useful), still changeable. A person can always pick the other one.
        setCountry((current) => current ?? defaultCountry(options));
      })
      .catch(() => setCountries([]));
  }, []);

  function go(next: Step) {
    setError(null);
    setNote(null);
    setStep(next);
  }

  /** A refusal from the YourTal sign-in, shown where the old errors are. */
  function yourtalFailed(message: string) {
    setNote(null);
    setError(message);
  }

  async function run(key: string, work: () => Promise<Session | null>) {
    setError(null);
    setBusy(key);
    try {
      const session = await work();
      if (session) onSignedIn(session);
      return session;
    } catch (e) {
      if (e instanceof ApiError && isUseYourtal(e.code)) {
        // An account already linked to YourTal: the old doors are shut, and
        // the YourTal button on this screen is the way in.
        setNote(`${SIGNIN_COPY.useYourtalTitle}. ${SIGNIN_COPY.useYourtalBody}`);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
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

  // 20pt gutter and a 16pt gap between fields (the premium pass's scale).
  // The top gets real room: this is the first screen anyone sees, and a form
  // that starts under the status bar reads as cramped before it is read.
  const pad = {
    padding: space.gutter,
    paddingTop: insets.top + space.xl,
    paddingBottom: insets.bottom + space.xxl,
    gap: space.lg,
  };

  /* ── Choose ─────────────────────────────────────────────────────────── */
  if (step === 'choose') {
    // Folded behind the link while YourTal is on or still being asked; open when it is off, failed, or the link was pressed.
    const showEmail = showEmailForm(yourtal, emailOpen);
    return (
      <Screen>
        <ScrollView
          contentContainerStyle={{ ...pad, paddingTop: insets.top + space.xxl, gap: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <BrandLockup width={176} style={{ alignSelf: 'flex-start' }} />
          <GradientHero>
            <View style={{ gap: space.sm }}>
              <HeroLabel>SnapApps</HeroLabel>
              <Text style={{ ...type.h1, ...brandFace, color: '#FFFFFF' }}>Receipts into records</Text>
              <HeroBody>
                Photograph a receipt, check what was read, keep a record that holds up.
              </HeroBody>
            </View>
          </GradientHero>

          {/* YourTal first: one button, YourTal's own page handles new and existing accounts. */}
          <View style={{ gap: space.sm }}>
            <YourtalSignInButtons
              mode="single"
              onSignedIn={onSignedIn}
              onFailure={yourtalFailed}
              onAvailability={setYourtal}
            />
            {yourtal ? <Small style={{ textAlign: 'center' }}>{SIGNIN_COPY.oneAccount}</Small> : null}
          </View>

          {notice ? <Notice tone="info" icon="info">{notice}</Notice> : null}
          {note ? <Notice tone="info" icon="info">{note}</Notice> : null}
          {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

          {yourtal !== false && !emailOpen ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEmailOpen(true)}
              style={{ minHeight: control.tap, justifyContent: 'center', alignSelf: 'center' }}
            >
              <Text style={[type.bodyStrong, { color: p.accentText, fontSize: 14 }]}>{SIGNIN_COPY.emailInstead}</Text>
            </Pressable>
          ) : null}

          {showEmail ? (
            <>
              <Card style={{ gap: space.md, padding: space.gutter }}>
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

              {accounts.length > 0 ? (
                <>
                  <DividerLabel>or continue as</DividerLabel>
                  {/* One white lifted card, rows divided by an inset hairline that
                      starts at the text, not the card edge. The inner view clips
                      so a pressed row follows the card's rounded corners (the Card
                      itself cannot clip: that would cut its shadow). */}
                  <Card padded={false}>
                    <View style={{ borderRadius: radius.xl, overflow: 'hidden' }}>
                      {accounts.map((a, i) => (
                        <Fragment key={a.userId}>
                          {i === 0 ? null : (
                            <View
                              style={{
                                height: StyleSheet.hairlineWidth * 2,
                                marginLeft: space.lg + 42 + space.md,
                                backgroundColor: p.rule,
                              }}
                            />
                          )}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Continue as ${a.displayName}`}
                            onPress={() => void run(a.email, () => api().signIn(a.email))}
                            style={({ pressed }) => ({
                              minHeight: 64,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: space.md,
                              paddingHorizontal: space.lg,
                              paddingVertical: space.md,
                              backgroundColor: pressed ? p.surface : 'transparent',
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
                        </Fragment>
                      ))}
                    </View>
                  </Card>
                  <Small style={{ textAlign: 'center', paddingHorizontal: space.sm }}>
                    Each one has a different role, so the app behaves differently. Dan is Staff: he
                    can scan and correct, but cannot post anything to the ledger.
                  </Small>
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  /* ── Register ───────────────────────────────────────────────────────── */
  if (step === 'register') {
    const canSubmit = name.trim().length > 1 && emailOk && pwOk && !!country && agreed;
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
          {/* `/v1/tax-rules-catalogue` is deliberately unguarded so this can
              be asked before a session exists. The answer decides which
              country's rules the workspace runs under, so it is required. */}
          <CountryPicker options={countries} value={country} onChange={setCountry} />

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
                backgroundColor: agreed ? p.accent : p.card,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {agreed ? <Icon name="check" size={16} color={p.accentInk} /> : null}
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
              void run('register', async () => {
                // Remembered BEFORE the session exists, because creating it
                // swaps this whole tree out for onboarding.
                if (country) await rememberCountry(country.rulesId, country.currency);
                return api().register(address, password, name.trim());
              })
            }
          />

          <YourtalSignInButtons mode="signUp" onSignedIn={onSignedIn} onFailure={yourtalFailed} />
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

          <YourtalSignInButtons mode="signIn" onSignedIn={onSignedIn} onFailure={yourtalFailed} />
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
  // A LINK, not a six-digit code (task 1.2.a). The link carries 256 random
  // bits, so it needs no attempt counter to be safe; a code would. It opens
  // the website's reset page, which works in this phone's browser, and the
  // person comes back here to log in with the new password.
  const sent = sentTo !== null && sentTo === address;
  return (
    <Screen>
      <BackBar onPress={() => go('login')} />
      <ScrollView contentContainerStyle={{ ...pad, paddingTop: space.xs }} keyboardShouldPersistTaps="handled">
        <AuthHeader title="Reset your password">
          Give us the email on your account. We send a link that lets you choose a new password.
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
        {sent ? (
          <>
            <Notice tone="info" icon="info">
              {`If ${address} has an account, a link is on its way. Open it on this phone to choose a new password. It works once, for 30 minutes. Then log in here.`}
            </Notice>
            <Button label="Back to log in" onPress={() => go('login')} />
            <Resend onResend={() => void api().requestPasswordReset(address).catch(() => {})} />
          </>
        ) : (
          <Button
            label="Send the link"
            busy={busy === 'reset-request'}
            disabled={!emailOk}
            onPress={() =>
              void (async () => {
                setBusy('reset-request');
                setError(null);
                try {
                  await api().requestPasswordReset(address);
                  setSentTo(address);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not send the link.');
                } finally {
                  setBusy(null);
                }
              })()
            }
          />
        )}
      </ScrollView>
    </Screen>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function AuthHeader({ title, children }: { title: string; children: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.md, paddingBottom: space.sm }}>
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 18,
          backgroundColor: p.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.sm,
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
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <TextInput
        accessibilityLabel={label}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.inkFaint}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoComplete={keyboardType === 'email-address' ? 'email' : 'name'}
        style={{
          // White fill, 1px edge, accent when focused: a field reads as a
          // field on a white card and on the bare ground alike.
          minHeight: control.input,
          borderWidth: 1,
          borderColor: invalid ? p.risk : focused ? p.accent : p.ruleStrong,
          borderRadius: radius.lg,
          backgroundColor: p.card,
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
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          minHeight: control.input,
          borderWidth: 1,
          borderColor: error ? p.risk : focused ? p.accent : p.ruleStrong,
          borderRadius: radius.lg,
          backgroundColor: p.card,
          paddingLeft: space.lg,
          paddingRight: space.sm,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
    borderWidth: 1,
    borderColor: p.ruleStrong,
    borderRadius: radius.lg,
    backgroundColor: p.card,
  };
  return (
    <>
      <DividerLabel>or continue with</DividerLabel>
      <View style={{ flexDirection: 'row', gap: space.md }}>
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
 * Full-bleed Shutter Orange with the shutter glyph fading up, which is the
 * prototype's one piece of real choreography (it was a blue screen before the
 * 2026-11-27 rebrand). It is also honest: this
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
        backgroundColor: '#EA542D',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Animated.View style={{ opacity: fade, transform: [{ translateY: rise }], alignItems: 'center' }}>
        <Image
          source={splashGlyph}
          accessibilityRole="image"
          accessibilityLabel="SnapApps"
          style={{ width: 132, height: 132 }}
          resizeMode="contain"
        />
        {/* White on orange is 3.6:1, so only this large wordmark is white; the
            small line under it is Ink (4.9:1), per the brand guide p20. */}
        <Text style={{ ...type.splash, ...brandFace, letterSpacing: 0.5, color: '#FFFFFF', marginTop: 22 }}>
          SnapApps
        </Text>
        <Text style={{ ...type.input, color: '#0F172A', marginTop: space.sm }}>Receipts into records</Text>
      </Animated.View>
    </View>
  );
}
