import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type PrivacySettings } from '@/api';
import { Toggle } from '@/components/form';
import { Body, Button, Notice, Row, Screen, ScreenHeader, Section, Small } from '@/components/ui';
import { space, usePalette } from '@/theme';

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
 *
 * Rebuilt 2026-10-19 (the instrument pass): the retention copy is plain text
 * under a label rather than a card, and the switches and links are sections of
 * hairline-divided rows. The delete button is the only filled control, and it
 * is red because it is the only destructive one.
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
          paddingHorizontal: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Privacy and data" onBack={() => router.back()} />

        <Section label="How long records are kept" style={{ gap: space.sm }}>
          <Body>
            Records are kept for {years} years, which is at or above what the ATO requires.
            Originals are stored in Australia.
          </Body>
          <Small>
            Everyone in this workspace can see everything in it. Removing someone revokes their
            access but does not remove what they captured, because those records belong to the
            workspace.
          </Small>
        </Section>

        {error ? <Notice tone="risk" icon="alert">{error}</Notice> : null}

        <Section label="Sharing">
          <View style={{ paddingVertical: 14 }}>
            <Toggle
              label="Anonymous analytics"
              hint="Which screens get used, never what is on a receipt."
              value={settings?.analyticsOptIn ?? false}
              onChange={(v) => void set('analyticsOptIn', v)}
            />
          </View>
          <View style={{ paddingVertical: 14, borderTopWidth: 1, borderTopColor: p.rule }}>
            <Toggle
              label="Crash reports"
              hint="Stack traces when something breaks, so it can be fixed."
              value={settings?.crashReports ?? false}
              onChange={(v) => void set('crashReports', v)}
            />
          </View>
          <View style={{ paddingVertical: 14, borderTopWidth: 1, borderTopColor: p.rule }}>
            <Toggle
              label="Help improve extraction"
              hint="Lets corrections you make train the shared reader. Off by default."
              value={settings?.contributeToModel ?? false}
              onChange={(v) => void set('contributeToModel', v)}
            />
          </View>
        </Section>

        <Section label="Your data">
          {/* Row pads its own 16pt sides; pull it out to the screen edge so its
              icon lines up with the section label above it. */}
          <View style={{ marginHorizontal: -space.lg }}>
            <Row
              title="Sign in with fingerprint"
              subtitle="Unlock this device without typing a password"
              icon="lock"
              iconTone="neutral"
              onPress={() => router.push('/fingerprint')}
            />
            <Row
              title="Export receipts"
              subtitle="Every photo, with the fields read from it"
              icon="upload"
              iconTone="neutral"
              onPress={() => router.push('/export')}
            />
          </View>
        </Section>

        <View style={{ gap: space.md }}>
          <Button label="Delete all receipts" tone="risk" icon="trash" onPress={confirmWipe} />
          <Small style={{ textAlign: 'center' }}>
            This clears every record in this space. Credits and points stay on your account.
          </Small>
        </View>
      </ScrollView>
    </Screen>
  );
}
