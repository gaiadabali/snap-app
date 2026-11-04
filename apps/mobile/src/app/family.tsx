import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FamilyStatus, TeenInviteCreated } from '@snap/api-contract';

import { api } from '@/api';
import { useWorkspace } from '@/workspace';
import { FamilyPanel } from '@/components/FamilyPanel';
import { Screen, ScreenHeader, Small } from '@/components/ui';
import { space } from '@/theme';

/** Family: invite your teen, end their access, or (as a teen) see who can see your space. Group 3.10. */
export default function FamilyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [status, setStatus] = useState<FamilyStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [created, setCreated] = useState<TeenInviteCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { active } = useWorkspace();

  const load = useCallback(() => {
    api()
      .getFamily()
      .then((s) => {
        setStatus(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useFocusEffect(load);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        <View style={{ gap: space.xs }}>
          <ScreenHeader title="Family" onBack={() => router.back()} />
        </View>
        {status ? (
          <FamilyPanel
            status={status}
            canInvite={active.role === 'owner' && !active.teenSpace}
            created={created}
            confirming={confirming}
            busy={busy}
            error={error}
            onCreate={() => void run(async () => setCreated(await api().createTeenInvite()))}
            onShare={(url) => void Share.share({ message: url })}
            onAskEnd={setConfirming}
            onCancelEnd={() => setConfirming(null)}
            onConfirmEnd={(id) =>
              void run(async () => {
                await api().endTeenAccess(id);
                setConfirming(null);
                load();
              })
            }
          />
        ) : (
          <Small>{failed ? 'Family isn’t available right now. Try again in a minute.' : 'Loading…'}</Small>
        )}
      </ScrollView>
    </Screen>
  );
}
