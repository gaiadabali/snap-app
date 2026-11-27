import { useRouter } from 'expo-router';
import type { MailSettingsView } from '@snap/api-contract';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { Choice, Toggle } from '@/components/form';
import { AppPasswords } from '@/components/mail/AppPasswords';
import { CopyButton } from '@/components/mail/CopyButton';
import { useMailAccount } from '@/components/mail/MailRoot';
import { Button, Card, Notice, ProgressBar, Screen, ScreenHeader, SectionHeader, Small } from '@/components/ui';
import { alertsStatusLine, bridgeErrorMessage, fileSize } from '@/lib/mail-format';
import { disableMailAlerts, enableMailAlerts, type AlertsOutcome } from '@/lib/push';
import { space, usePalette } from '@/theme';
import { Text } from '@/theme/text';
import { useWorkspace } from '@/workspace';

function Section({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title={title} />
      {lede ? <Small>{lede}</Small> : null}
      {children}
    </View>
  );
}

/**
 * Mail settings, the same sections and words as the website: the address, importing mailed
 * statements (off until chosen, into a workspace the person owns or administers), phone
 * alerts, and the app passwords for phone mail apps.
 */
export default function MailSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const p = usePalette();
  const account = useMailAccount();
  const { workspaces } = useWorkspace();
  const settings = account.settings;
  const [pending, setPending] = useState<'statements' | 'workspace' | 'alerts' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertsOutcome | null>(null);

  // Statements may only go to a workspace the person owns or administers (BUILD.md §5.6); a teen's space never.
  const eligible = workspaces.filter((w) => w.teenSpace !== 'teen' && (w.role === 'owner' || w.role === 'admin'));

  // When alerts are on, say whether this phone can actually get them. Never prompts here.
  useEffect(() => {
    if (!settings.alerts) return;
    let live = true;
    void enableMailAlerts({ prompt: false }).then((o) => live && setAlerts(o));
    return () => {
      live = false;
    };
    // Read once on opening the screen: toggling alerts below sets the outcome itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Partial<MailSettingsView>, which: 'statements' | 'workspace' | 'alerts'): Promise<boolean> {
    const before = settings;
    account.setSettings({ ...settings, ...patch });
    setPending(which);
    setProblem(null);
    try {
      account.setSettings(await api().updateMailSettings(patch));
      return true;
    } catch (e) {
      account.setSettings(before);
      setProblem(bridgeErrorMessage(e));
      return false;
    } finally {
      setPending(null);
    }
  }

  async function setAlertsOn(next: boolean) {
    if (!(await save({ alerts: next }, 'alerts'))) return;
    if (next) setAlerts(await enableMailAlerts({ prompt: true }));
    else {
      setAlerts(null);
      await disableMailAlerts();
    }
  }

  const chosen = eligible.find((w) => w.id === settings.workspaceId) ?? null;
  const quota = account.quota;
  const usedPct = quota && quota.limitBytes > 0 ? Math.min(1, quota.usedBytes / quota.limitBytes) : 0;
  const alertsLine = settings.alerts ? alertsStatusLine(alerts) : null;

  return (
    <Screen>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Mail settings" onBack={() => router.back()} />

        {problem ? (
          <Notice tone="risk" icon="alert" onDismiss={() => setProblem(null)}>
            {problem}
          </Notice>
        ) : null}

        <Section
          title="Your address"
          lede="Generated for you when you switched mail on. It is the same address in SnapApp, YourTal and Free Tax Returns."
        >
          <Card style={{ gap: space.sm }}>
            <Text selectable testID="mail-address" style={{ color: p.ink, fontSize: 16, lineHeight: 22, fontWeight: '600' }}>
              {account.address}
            </Text>
            <CopyButton text={account.address} label="Copy your address" />
            {quota ? (
              <View style={{ gap: 6 }}>
                <ProgressBar value={usedPct} />
                <Small>
                  {fileSize(quota.usedBytes)} of {fileSize(quota.limitBytes)} used
                </Small>
              </View>
            ) : null}
          </Card>
        </Section>

        <Section title="Statements">
          <Card padded={false} style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md, opacity: pending === 'statements' ? 0.7 : 1 }}>
            <Toggle
              label="Import statements from this inbox"
              hint="When a bank or card statement (PDF or CSV) arrives here, SnapApp adds it to the workspace below. Only mail that passes the sender’s own authenticity checks is used, and it costs the same as an upload: CSV is free, a PDF uses one credit."
              value={settings.statements}
              onChange={(next) => {
                if (eligible.length === 0 || pending !== null) return;
                const workspaceId = settings.workspaceId ?? eligible[0]?.id ?? null;
                void save(next ? { statements: true, workspaceId } : { statements: false }, 'statements');
              }}
            />
            {eligible.length === 0 ? (
              <Small>You need a workspace you own or administer to import statements into.</Small>
            ) : (
              <View style={{ gap: 4 }}>
                <Choice
                  label="Import into"
                  options={eligible.map((w) => ({ value: w.id, label: w.name }))}
                  value={chosen?.id ?? ''}
                  onChange={(id) => {
                    if (pending === null) void save({ workspaceId: id }, 'workspace');
                  }}
                />
                <Small>Only workspaces you own or administer are listed.</Small>
              </View>
            )}
          </Card>
        </Section>

        <Section title="Alerts">
          <Card padded={false} style={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm, opacity: pending === 'alerts' ? 0.7 : 1 }}>
            <Toggle
              label="Phone alerts for new mail"
              hint="SnapApp tells you when new mail arrives. The alert says how many, never who from or what about."
              value={settings.alerts}
              onChange={(next) => {
                if (pending === null) void setAlertsOn(next);
              }}
            />
            {alertsLine ? <Small>{alertsLine}</Small> : null}
            {settings.alerts && alerts === 'denied' ? (
              <Button label="Open phone settings" tone="outline" onPress={() => void Linking.openSettings().catch(() => undefined)} />
            ) : null}
          </Card>
        </Section>

        <Section
          title="Phone mail apps"
          lede="To read this inbox in an app such as Gmail, Apple Mail or Outlook, give the app its own password. It is separate from how you sign in, and revoking it cuts that app off at once."
        >
          <AppPasswords />
        </Section>
      </ScrollView>
    </Screen>
  );
}
