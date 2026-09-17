import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type AuthUser, type Session } from '@/api';
import { Avatar, Field } from '@/components/form';
import { GradientHero, HeroBody, HeroFigure, HeroLabel, Raised } from '@/components/rich';
import { Body, Button, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { radius, space, usePalette } from '@/theme';

/**
 * Signing in.
 *
 * No password field, and there will never be one: the server delegates to an
 * identity provider and stores only the external subject. A finance app that
 * keeps its own password table is a breach waiting for a news cycle.
 *
 * The demo accounts are listed on purpose. The point of building identity was
 * to make roles real, and a presenter needs to become a Staff member in one
 * tap to show that they cannot post to the ledger — typing an address from
 * memory in front of an audience is how demos die.
 */
export function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [accounts, setAccounts] = useState<AuthUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api().listDemoAccounts().then(setAccounts);
  }, []);

  async function signIn(address: string) {
    setError(null);
    setBusy(address);
    try {
      onSignedIn(await api().signIn(address));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(null);
    }
  }

  async function withPassword() {
    const address = email.trim().toLowerCase();
    setError(null);
    setBusy(address);
    try {
      onSignedIn(
        mode === 'register'
          ? await api().register(address, password)
          : await api().signInWithPassword(address, password),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(null);
    }
  }

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  // Mirrors MIN_PASSWORD_LENGTH in apps/server/src/auth/passwords.ts, and
  // counts code points the same way — five emoji are five characters to the
  // person typing them and ten to `String.length`.
  const longEnough = [...password].length >= 10;

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
        <GradientHero>
          <View style={{ gap: space.xs }}>
            <HeroLabel>Snap Apps</HeroLabel>
            <HeroFigure small>Receipts into records</HeroFigure>
            <HeroBody>
              Photograph a receipt, check what was read, and keep a record the ATO accepts.
            </HeroBody>
          </View>
        </GradientHero>

        <Raised style={{ gap: space.md }}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'register' ? 'At least 10 characters' : ''}
            autoCapitalize="none"
            secureTextEntry
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            hint={
              mode === 'register'
                ? 'At least 10 characters. Save it somewhere — there is no reset yet.'
                : undefined
            }
          />
          <Button
            label={mode === 'register' ? 'Create account' : 'Sign in'}
            onPress={() => void withPassword()}
            disabled={!valid || !longEnough}
            busy={busy === email.trim().toLowerCase()}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMode(mode === 'register' ? 'sign-in' : 'register');
              setError(null);
            }}
          >
            <Small style={{ textAlign: 'center' }}>
              {mode === 'register'
                ? 'Already have an account? Sign in'
                : 'New here? Create an account'}
            </Small>
          </Pressable>
          {error ? (
            <View style={{ backgroundColor: p.riskSoft, borderRadius: radius.md, padding: space.md }}>
              <Small muted={false} style={{ color: p.risk }}>
                {error}
              </Small>
            </View>
          ) : null}
        </Raised>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Divider style={{ flex: 1 }} />
          <Small>or continue as</Small>
          <Divider style={{ flex: 1 }} />
        </View>

        <View style={{ gap: space.sm }}>
          <Label>Demo accounts</Label>
          <Raised style={{ padding: 0 }}>
            {accounts.map((a, i) => (
              <View key={a.userId}>
                {i > 0 ? <Divider style={{ marginLeft: 64 }} /> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Continue as ${a.displayName}`}
                  onPress={() => void signIn(a.email)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: 13,
                    backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                    opacity: busy && busy !== a.email ? 0.5 : 1,
                  })}
                >
                  <Avatar initials={a.initials} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body strong>{a.displayName}</Body>
                    <Small numberOfLines={1}>{a.email}</Small>
                  </View>
                  {busy === a.email ? (
                    <Small>Signing in…</Small>
                  ) : (
                    <Text style={{ color: p.inkFaint, fontSize: 17 }}>›</Text>
                  )}
                </Pressable>
              </View>
            ))}
          </Raised>
          <Small>
            Each one has a different role, so the app behaves differently. Dan is Staff: he can
            scan and correct, but cannot post anything to the ledger.
          </Small>
        </View>

        <Small style={{ textAlign: 'center' }}>
          A new account asks you to set up a workspace. The same account signs in to the
          website dashboard — one login for both.
        </Small>
        <Small style={{ textAlign: 'center' }}>
          There is no password reset yet: resetting one needs email, and no mail provider is
          configured. Keep your password somewhere safe.
        </Small>
      </ScrollView>
    </Screen>
  );
}

/** Shown while the stored session is being read. */
export function SessionLoading() {
  const p = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: p.ground, alignItems: 'center', justifyContent: 'center' }}>
      <Figure size="h2">Snap Apps</Figure>
    </View>
  );
}
