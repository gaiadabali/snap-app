import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { DELETE_WORD, DeleteAccountPanel } from '@/components/DeleteAccountPanel';
import { Screen, ScreenHeader } from '@/components/ui';
import { useSession } from '@/session';
import { useWorkspace } from '@/workspace';
import { space } from '@/theme';

/** Settings → Delete account (group 8.3.a): the explanation, the typed word, then sign out. */
export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, signOut } = useSession();
  const { workspaces } = useWorkspace();
  const teenRole = workspaces.some((w) => w.teenSpace === 'teen')
    ? 'teen'
    : workspaces.some((w) => w.teenSpace === 'parent')
      ? 'parent'
      : null;
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await api().deleteAccount({ confirm: DELETE_WORD, password: password || undefined });
      // The server has already ended every session; this clears the phone and shows sign-in.
      await signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account. Try again with a connection.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: space.gutter,
            paddingTop: insets.top + space.md,
            paddingBottom: insets.bottom + space.xxl,
            gap: space.xl,
          }}
        >
          <View style={{ gap: space.xs }}>
            <ScreenHeader title="Delete account" onBack={() => router.back()} />
          </View>
          <DeleteAccountPanel
            yourtalLinked={session?.yourtalLinked}
            teenRole={teenRole}
            typed={typed}
            password={password}
            busy={busy}
            error={error}
            onType={setTyped}
            onPassword={setPassword}
            onDelete={() => void remove()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
