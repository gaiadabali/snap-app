import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type PrivacySettings } from '@/api';
import { Icon } from '@/components/Icon';
import { Toggle } from '@/components/form';
import {
  Button,
  Card,
  Divider,
  Notice,
  Row,
  Screen,
  ScreenHeader,
  Small,
} from '@/components/ui';
import { space, type, usePalette } from '@/theme';

/**
 * What is kept, for how long, and who can see it.
 *
 * The retention figure is stated rather than offered as a slider: five years
 * is the ATO substantiation floor, the server clamps below it, and a control
 * that lets someone choose an illegal answer is worse than no control.
 *
 * "Delete all receipts" is the one destructive action in the app and is
 * confirmed twice — once here, once by the platform dialog — because it cannot
 * be undone and the originals are the record.
 */
export default function PrivacyScreen() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      void api()
        .getPrivacySettings()
        .then((x) => live && setSettings(x))
        .catch(() => {});
      return () => {
        live = false;
      };
    }, []),
  );

  async function set(key: keyof PrivacySettings, value: boolean) {
    if (!settings) return;
    const before = settings;
    setSettings({ ...settings, [key]: value });
    setError(null);
    try {
      setSettings(await api().updatePrivacySettings({ [key]: value }));
    } catch (e) {
      setSettings(before);
      setError(e instanceof Error ? e.message : 'That did not save.');
    }
  }

  function confirmWipe() {
    Alert.alert(
      'Delete every receipt?',
      'This clears every record in this space, including the original photos. It cannot be undone. Credits and points stay on your account.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () =>
            setError(
              'Bulk delete is not wired up yet — there is no endpoint for it. Delete receipts individually for now.',
            ),
        },
      ],
    );
  }

  const years = Math.round((settings?.retentionMonths ?? 60) / 12);

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: 14,
        }}
      >
        <ScreenHeader title="Privacy and data" onBack={() => router.back()} />

        <Card style={{ gap: 10, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="info" size={16} color={p.inkMuted} />
            <Text style={[type.label, { color: p.inkMuted }]}>How long records are kept</Text>
          </View>
          <Text style={[type.body, { color: p.ink, fontSize: 14, lineHeight: 21 }]}>
            Records are kept for {years} years, which is at or above what the ATO requires.
            Originals are stored in Australia.
          </Text>
          <Small>
            Everyone in this workspace can see everything in it. Removing someone revokes their
            access but does not remove what they captured, because those records belong to the
            workspace.
          </Small>
        </Card>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Card padded={false}>
          <View style={{ paddingHorizontal: space.lg, paddingVertical: 14 }}>
            <Toggle
              label="Anonymous analytics"
              hint="Which screens get used, never what is on a receipt."
              value={settings?.analyticsOptIn ?? false}
              onChange={(v) => void set('analyticsOptIn', v)}
            />
          </View>
          <Divider />
          <View style={{ paddingHorizontal: space.lg, paddingVertical: 14 }}>
            <Toggle
              label="Crash reports"
              hint="Stack traces when something breaks, so it can be fixed."
              value={settings?.crashReports ?? false}
              onChange={(v) => void set('crashReports', v)}
            />
          </View>
          <Divider />
          <View style={{ paddingHorizontal: space.lg, paddingVertical: 14 }}>
            <Toggle
              label="Help improve extraction"
              hint="Lets corrections you make train the shared reader. Off by default."
              value={settings?.contributeToModel ?? false}
              onChange={(v) => void set('contributeToModel', v)}
            />
          </View>
        </Card>

        <Card padded={false}>
          <Row
            title="Sign in with fingerprint"
            subtitle="Unlock this device without typing a password"
            icon="lock"
            iconTone="neutral"
            onPress={() => router.push('/fingerprint')}
          />
          <Divider />
          <Row
            title="Export receipts"
            subtitle="Every photo, with the fields read from it"
            icon="upload"
            iconTone="neutral"
            onPress={() => router.push('/export')}
          />
        </Card>

        <Button label="Delete all receipts" tone="risk" icon="trash" onPress={confirmWipe} />
        <Small style={{ textAlign: 'center' }}>
          This clears every record in this space. Credits and points stay on your account.
        </Small>
      </ScrollView>
    </Screen>
  );
}
