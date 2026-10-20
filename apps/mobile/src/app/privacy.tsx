import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type PrivacySettings } from '@/api';
import { Toggle } from '@/components/form';
import {
  Body,
  Card,
  Divider,
  Notice,
  Row,
  Screen,
  ScreenHeader,
  SectionHeader,
  Small,
} from '@/components/ui';
import { EXPERIMENTAL_FEATURES_ENABLED } from '@/config';
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
      'This clears every record in this space, including the original photos. It cannot be undone. Your credits and your YourTal link stay on your account.',
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
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Privacy and data" onBack={() => router.back()} />

        <View style={{ gap: space.md }}>
          <SectionHeader title="How long records are kept" />
          <Card>
            <Body>
              Records are kept for {years} years, which is at or above what the ATO requires.
              Originals are stored in Australia.
            </Body>
          </Card>
          <Small>
            Everyone in this workspace can see everything in it. Removing someone revokes their
            access but does not remove what they captured, because those records belong to the
            workspace.
          </Small>
        </View>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <View style={{ gap: space.md }}>
          <SectionHeader title="Sharing" />
          <Card padded={false}>
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
              <Toggle
                label="Anonymous analytics"
                hint="Which screens get used, never what is on a receipt."
                value={settings?.analyticsOptIn ?? false}
                onChange={(v) => void set('analyticsOptIn', v)}
              />
            </View>
            <Divider style={{ marginLeft: space.lg }} />
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
              <Toggle
                label="Crash reports"
                hint="Stack traces when something breaks, so it can be fixed."
                value={settings?.crashReports ?? false}
                onChange={(v) => void set('crashReports', v)}
              />
            </View>
            <Divider style={{ marginLeft: space.lg }} />
            <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
              <Toggle
                label="Help improve extraction"
                hint="Lets corrections you make train the shared reader. Off by default."
                value={settings?.contributeToModel ?? false}
                onChange={(v) => void set('contributeToModel', v)}
              />
            </View>
          </Card>
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader title="Your data" />
          <Card padded={false}>
            {EXPERIMENTAL_FEATURES_ENABLED ? (
              <>
                <Row
                  title="Sign in with fingerprint"
                  subtitle="Unlock this device without typing a password"
                  icon="lock"
                  iconTone="neutral"
                  onPress={() => router.push('/fingerprint')}
                />
                <Divider style={{ marginLeft: space.lg + 40 + 14 }} />
              </>
            ) : null}
            <Row
              title="Export receipts"
              subtitle="Every photo, with the fields read from it"
              icon="upload"
              iconTone="neutral"
              onPress={() => router.push('/export')}
            />
          </Card>
        </View>

        {/* The one destructive action, as a plain red text row at the bottom
            rather than a filled red button: red is money at risk, and a solid
            block of it invites the tap. The two-step confirmation does the
            real protecting. */}
        <View style={{ gap: space.md }}>
          <Card padded={false}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete all receipts"
              onPress={confirmWipe}
              style={({ pressed }) => ({
                minHeight: 52,
                justifyContent: 'center',
                paddingHorizontal: space.lg,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={[type.bodyStrong, { color: p.risk }]}>Delete all receipts</Text>
            </Pressable>
          </Card>
          <Small>
            This clears every record in this space. Your credits and your YourTal link stay on your account.
          </Small>
        </View>
      </ScrollView>
    </Screen>
  );
}
