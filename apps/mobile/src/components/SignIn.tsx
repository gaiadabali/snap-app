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

  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

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
            hint="We send a link. There is no password to remember or to lose."
          />
          <Button
            label="Continue"
            onPress={() => void signIn(email)}
            disabled={!valid}
            busy={busy === email}
          />
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
          An address we do not recognise creates a new account and asks you to set up a workspace.
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
