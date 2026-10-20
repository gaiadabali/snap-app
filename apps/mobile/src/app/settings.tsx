import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IS_DEMO, abnIsValid, api, resetDemoData, type BusinessSettings, type PlanUsage } from '@/api';
import { currentDevice, deviceReadAvailable } from '@/lib/device-read';
import { BUILD } from '@/lib/updates';
import { Icon } from '@/components/Icon';
import { Avatar, Choice, Field, Loading, Sheet, Toggle } from '@/components/form';
import { Body, Card, Divider, Figure, Screen, SectionHeader, Small } from '@/components/ui';
import { formatAbn, space, type, usePalette } from '@/theme';
import { useSession } from '@/session';
import { WorkspacePicker, useWorkspace } from '@/workspace';

/**
 * Settings for the active workspace.
 *
 * Business details, people, categories, plan and connections in one place,
 * because they are all answers to "how is this workspace set up" and splitting
 * them across five menu entries made each one look emptier than it is.
 *
 * A personal workspace never sees the tax section: it has no ABN, no GST
 * registration and no BAS, and offering the fields would imply otherwise.
 *
 * Laid out like a phone's own settings: each group is a heading over one white
 * lifted card whose rows are divided by a hairline inset from the left edge,
 * explanatory copy sits as small grey text under its group, and the
 * destructive actions are plain red text rows at the bottom.
 */
export default function SettingsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isBusiness, workspaceName, active } = useWorkspace();
  const { session, signOut } = useSession();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  const [editing, setEditing] = useState<null | 'details'>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState({ name: '', abn: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, pl] = await Promise.all([api().getBusinessSettings(), api().getPlanUsage()]);
    setSettings(s);
    setPlan(pl);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function saveDetails() {
    setError(null);
    const abn = draft.abn.replace(/\D/g, '');
    if (abn && !abnIsValid(abn)) {
      setError('That ABN fails the ATO modulus-89 checksum. Check the digits.');
      return;
    }
    try {
      setSettings(await api().updateBusinessSettings({ name: draft.name.trim(), abn: abn || null }));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save those details.');
    }
  }

  async function setBasis(gstBasis: 'cash' | 'accrual') {
    setSettings(await api().updateBusinessSettings({ gstBasis }));
  }

  async function setRegistered(gstRegistered: boolean) {
    setSettings(await api().updateBusinessSettings({ gstRegistered }));
  }

  const roleWord = active.role === 'admin' ? 'a manager' : `an ${active.role}`;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.xl,
        }}
      >
        {settings === null || plan === null ? (
          <Loading />
        ) : (
          <>
            {/* Who you are. First, because everything below is scoped to it —
                and because a shared workspace makes "which account am I in"
                a question people actually need answered. */}
            {session ? (
              <View style={{ gap: space.md }}>
                <SectionHeader title="Signed in" />
                <Card padded={false}>
                  <View style={rowStyle}>
                    <Avatar initials={session.user.initials} size={44} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Body strong numberOfLines={1}>
                        {session.user.displayName}
                      </Body>
                      <Small numberOfLines={1}>{session.user.email}</Small>
                    </View>
                  </View>
                </Card>
                <Small>
                  In {session.workspaceIds.length} workspace
                  {session.workspaceIds.length === 1 ? '' : 's'} · you are {roleWord} here
                </Small>
              </View>
            ) : null}

            {/* Workspace */}
            <View style={{ gap: space.md }}>
              <SectionHeader title="Workspace" />
              <Card padded={false}>
                <View style={rowStyle}>
                  <Avatar initials={workspaceName.slice(0, 2).toUpperCase()} size={44} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Body strong numberOfLines={1}>
                      {workspaceName}
                    </Body>
                    <Small>
                      {isBusiness ? 'Business' : 'Personal'} · {active.memberCount}{' '}
                      {active.memberCount === 1 ? 'person' : 'people'} · you are {roleWord}
                    </Small>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Switch workspace"
                    hitSlop={8}
                    onPress={() => setPicking(true)}
                  >
                    <Text style={[type.bodyStrong, { color: p.accentText }]}>Switch</Text>
                  </Pressable>
                </View>
                <Divider style={{ marginLeft: space.lg }} />
                <Row
                  label="People"
                  value={`${active.memberCount} in this workspace`}
                  href="/members"
                />
              </Card>
            </View>

            {/* Business details */}
            {isBusiness ? (
              <View style={{ gap: space.md }}>
                <SectionHeader
                  title="Business details"
                  action={{
                    label: 'Edit',
                    onPress: () => {
                      setDraft({ name: settings.name, abn: settings.abn ?? '' });
                      setError(null);
                      setEditing('details');
                    },
                  }}
                />
                <Card padded={false}>
                  <Info label="Trading name" value={settings.name} />
                  <Divider style={{ marginLeft: space.lg }} />
                  <Info
                    label="ABN"
                    value={settings.abn ? formatAbn(settings.abn) : 'Not set'}
                    hint={
                      settings.abn
                        ? settings.abnValid
                          ? 'Passes the modulus-89 checksum'
                          : 'Fails its checksum'
                        : 'Required on every tax invoice you issue'
                    }
                    tone={settings.abn && !settings.abnValid ? 'risk' : 'ink'}
                  />
                  <Divider style={{ marginLeft: space.lg }} />
                  <Info
                    label="Occupation"
                    value={settings.occupationLabel ?? 'Not set'}
                    hint="Decides which deduction rows the app offers"
                  />
                  <Divider style={{ marginLeft: space.lg }} />
                  <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                    <Toggle
                      label="Registered for GST"
                      hint="Turn off and the app stops calculating a BAS position"
                      value={settings.gstRegistered}
                      onChange={(v) => void setRegistered(v)}
                    />
                  </View>
                  {settings.gstRegistered ? (
                    <>
                      <Divider style={{ marginLeft: space.lg }} />
                      <View style={{ paddingHorizontal: space.lg, paddingVertical: space.md }}>
                        <Choice
                          label="GST basis"
                          value={settings.gstBasis}
                          onChange={(v) => void setBasis(v)}
                          options={[
                            { value: 'cash', label: 'Cash' },
                            { value: 'accrual', label: 'Accrual' },
                          ]}
                        />
                      </View>
                    </>
                  ) : null}
                </Card>
                <Small>
                  {settings.gstBasis === 'cash'
                    ? 'Cash basis: GST counts in the quarter money changes hands.'
                    : 'Accrual basis: GST counts in the quarter the invoice is issued.'}
                  {settings.simplerBas
                    ? ' Simpler BAS — G1, 1A and 1B only, for turnover under $10M.'
                    : ''}
                </Small>
              </View>
            ) : null}

            {/* Everything else */}
            <Card padded={false}>
              <Row label="Categories" value="How spending is sorted" href="/categories" />
              <Divider style={{ marginLeft: space.lg }} />
              <Row label="Credits and usage" value={`${plan.scansUsed} read this month`} href="/plan" />
              {isBusiness ? (
                <>
                  <Divider style={{ marginLeft: space.lg }} />
                  <Row label="Accounting connections" value="Xero, MYOB, QuickBooks" href="/connections" />
                </>
              ) : null}
              {isBusiness ? (
                <>
                  <Divider style={{ marginLeft: space.lg }} />
                  <Row label="Tax pack" value="Export for your accountant" href="/taxpack" />
                </>
              ) : null}
            </Card>

            {/* Data and privacy — not a legal footnote, an actual control. */}
            <View style={{ gap: space.md }}>
              <SectionHeader title="Data and privacy" />
              <Card>
                <Body>
                  Records are kept for {Math.round(plan.retentionMonths / 12)} years, which is what
                  the ATO requires of business records. Originals are stored in Australia.
                </Body>
              </Card>
              <Small>
                Everyone in this workspace can see everything in it. Removing someone revokes their
                access but does not remove what they captured — those records belong to the
                workspace.
              </Small>
            </View>

            {/* WHAT THIS PHONE CAN DO, stated rather than discovered.
                ON-DEVICE.md §9: reading on the server is a real outcome, not a
                failure. So this is not a warning and not a blocker — the app
                captures, uploads and reads identically on every supported
                phone. The only thing a smaller device misses is the instant
                preview while it waits, and somebody who never sees that
                preview deserves to know it exists rather than assume the app
                is slow. */}
            <AppVersion />
            <DeviceSupport />

            {/* A demo that cannot be put back is a demo you can only give
                once. Everything the app changes is stored locally, so this
                returns it to the shipped fixture. Only on fixtures: against
                the real API this copy is untrue and the reset touches
                nothing. */}
            {IS_DEMO ? (
              <View style={{ gap: space.md }}>
                <SectionHeader title="Demo data" />
                <Card padded={false}>
                  <DangerRow
                    label="Reset demo data"
                    onPress={() =>
                      Alert.alert(
                        'Reset demo data?',
                        'Invoices, payments, budgets, trips, goals and corrections you have made on this device are discarded.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Reset',
                            style: 'destructive',
                            onPress: () => {
                              void resetDemoData().then(() => {
                                void load();
                                router.replace('/');
                              });
                            },
                          },
                        ],
                      )
                    }
                  />
                </Card>
                <Small>
                  Every change you make is saved on this device. Reset returns the app to the
                  figures it ships with.
                </Small>
              </View>
            ) : null}

            {/* Sign out sits last, as a plain red row: the one thing here that
                ends the session, kept away from the controls above. */}
            {session ? (
              <Card padded={false}>
                <DangerRow
                  label="Sign out"
                  onPress={() =>
                    Alert.alert('Sign out?', 'Your data stays on this device.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
                    ])
                  }
                />
              </Card>
            ) : null}

            {IS_DEMO ? <Small style={{ textAlign: 'center' }}>Snap Apps · demo build</Small> : null}
          </>
        )}
      </ScrollView>

      <WorkspacePicker open={picking} onClose={() => setPicking(false)} />

      <Sheet
        open={editing === 'details'}
        title="Business details"
        subtitle="These appear on every invoice you issue."
        error={error}
        submitLabel="Save"
        submitDisabled={!draft.name.trim()}
        onClose={() => setEditing(null)}
        onSubmit={saveDetails}
      >
        <Field
          label="Trading name"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          autoFocus
        />
        <Field
          label="ABN"
          value={draft.abn}
          onChangeText={(abn) => setDraft({ ...draft, abn })}
          keyboardType="number-pad"
          placeholder="51 824 753 556"
          hint="Checked against the ATO modulus-89 algorithm before saving"
        />
      </Sheet>
    </Screen>
  );
}

/** The shape every row in a settings card shares. */
const rowStyle = {
  minHeight: 64,
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.md,
  paddingHorizontal: space.lg,
  paddingVertical: space.md,
} as const;

/** A label and its value on one line, with an optional explanation under it. */
function Info({
  label,
  value,
  hint,
  tone = 'ink',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ink' | 'risk';
}) {
  return (
    <View style={{ gap: 2, paddingHorizontal: space.lg, paddingVertical: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        <Body muted>{label}</Body>
        <Figure tone={tone} style={{ flexShrink: 1, textAlign: 'right' }}>
          {value}
        </Figure>
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}

function Row({ label, value, href }: { label: string; value: string; href: Href }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body strong>{label}</Body>
        <Small numberOfLines={1}>{value}</Small>
      </View>
      <Icon name="chevronRight" size={18} color={p.inkFaint} />
    </Pressable>
  );
}

/** A destructive action as a plain red text row, iOS-settings style. */
function DangerRow({ label, onPress }: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        justifyContent: 'center',
        paddingHorizontal: space.lg,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text style={[type.bodyStrong, { color: p.risk }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Whether on-device reading is available here, and why not when it is not.
 *
 * THE NUMBER IS A CHOICE, NOT A MEASUREMENT, and the copy is written so it
 * cannot be read as one. `docs/ON-DEVICE.md` §1.2 picks 4 GB because that is
 * what Samsung sells in Australian retail, and nobody has ever run this on a
 * 4 GB handset — the test device has 7.5 GB and `bench/devices.py` refuses to
 * let it settle a fit question for exactly that reason. So this says what is
 * SUPPORTED, never what was verified.
 *
 * It reports what this phone actually has, rather than a generic requirements
 * list, because the useful question is "does mine do it" and the app already
 * knows the answer.
 */
function DeviceSupport() {
  const device = currentDevice();
  const available = deviceReadAvailable();

  // Web, Expo Go, or a build without the native module: there is no device to
  // describe and no claim worth making.
  if (!device) return null;

  const enoughMemory = device.totalMemoryMb >= 4096 - 512;

  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title="This device" />
      <Card style={{ gap: space.sm }}>
        <Body>
          {device.model} · {device.totalMemoryMb} MB · {device.platform} {device.osVersion}
        </Body>
        {available ? (
          <Small>
            Receipts are read on this phone while they upload, so a total appears before the
            server answers. The server reads every receipt too, and its answer is the one kept.
          </Small>
        ) : (
          <Small>
            Reading happens on the server for this phone. Everything works the same — captures,
            records and totals — you just will not see a preview while a receipt uploads.
            {enoughMemory
              ? ' The on-device reader needs Google Play services, which this device does not appear to have.'
              : ' The on-device reader is offered on phones with 4 GB of memory or more.'}
          </Small>
        )}
      </Card>
    </View>
  );
}

/**
 * Which build this is, so a tester can say "I am on 0.1.218" and a bug report
 * can be matched to a commit. Dev builds and Expo Go carry none of it, and say
 * so rather than showing blank rows that look like a bug.
 */
function AppVersion() {
  const known = BUILD.version || BUILD.versionCode !== null || BUILD.commit;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title="App version" />
      <Card style={{ gap: space.sm }}>
        {known ? (
          <>
            <Body>Version {BUILD.version || 'unknown'}</Body>
            <Small>
              Build {BUILD.versionCode ?? 'unknown'} · commit {BUILD.commit.slice(0, 7) || 'unknown'}
            </Small>
          </>
        ) : (
          <Small>
            This is a development build, so it has no version, build number or commit to show.
          </Small>
        )}
      </Card>
    </View>
  );
}
