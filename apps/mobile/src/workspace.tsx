import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';

import { api, setActiveWorkspaceId, type MemberRole, type Workspace, type WorkspaceSummary } from '@/api';
import { Avatar, Choice, Field, Sheet } from '@/components/form';
import { Body, Button, Chip, Figure, Label, Screen, Small } from '@/components/ui';
import { BUSINESS_FEATURES_ENABLED } from '@/config';
import { radius, space, usePalette } from '@/theme';

/**
 * Which workspace the app is in.
 *
 * A workspace is a tenant, not a flag on a row. That is the decision the whole
 * collaboration feature rests on: if personal and business shared one account
 * with a boolean to tell them apart, inviting a partner to the household would
 * hand them the company's books, because isolation is per tenant. As separate
 * tenants, sharing one costs nothing to isolate.
 *
 * The active choice is persisted — reopening in the wrong workspace and filing
 * a grocery run against the BAS is invisible until an accountant finds it —
 * but it is never WAITED for. An earlier version blocked rendering until
 * storage answered and, where the storage module is absent, the app came up
 * blank. It now starts on the first workspace and adopts the stored one when
 * it arrives.
 */

const KEY = 'snap.workspaceId';

type Ctx = {
  workspaces: WorkspaceSummary[];
  active: WorkspaceSummary;
  /** Convenience mirrors of `active`, because almost every screen wants these. */
  workspace: Workspace;
  workspaceId: string;
  workspaceName: string;
  role: MemberRole;
  isBusiness: boolean;
  setActive: (id: string) => void;
  /** Switches to the first workspace of that kind, creating nothing. */
  setKind: (kind: Workspace) => void;
  refresh: () => Promise<void>;
};

const FALLBACK: WorkspaceSummary = {
  id: '',
  name: 'Workspace',
  kind: 'business',
  role: 'owner',
  memberCount: 1,
  abn: null,
};

const WorkspaceContext = createContext<Ctx>({
  workspaces: [],
  active: FALLBACK,
  workspace: 'business',
  workspaceId: '',
  workspaceName: 'Workspace',
  role: 'owner',
  isBusiness: true,
  setActive: () => {},
  setKind: () => {},
  refresh: async () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const p = usePalette();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      const list = await api().listWorkspaces();
      setWorkspaces(list);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Storage is read alongside, not before: a slow or missing store must not
    // hold up the app, so whatever it returns is applied when it returns.
    void Promise.resolve()
      .then(() => AsyncStorage.getItem(KEY))
      .then((v) => {
        if (v) setActiveId(v);
      })
      .catch(() => {});
  }, [refresh]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    void Promise.resolve()
      .then(() => AsyncStorage.setItem(KEY, id))
      .catch(() => {});
  }, []);

  const rawList = workspaces ?? [];
  // Personal-only (`BUSINESS_FEATURES_ENABLED`): business workspaces are
  // withheld from the app entirely, not just from the switcher, so nothing
  // downstream — the switcher, the menu, home — ever has to ask the flag
  // again. See `PersonalOnlyGate` below for the one case this creates: an
  // account whose ONLY workspace is a business.
  const list = BUSINESS_FEATURES_ENABLED ? rawList : rawList.filter((w) => w.kind === 'personal');
  const active = list.find((w) => w.id === activeId) ?? list[0] ?? FALLBACK;

  // The API layer scopes every tenant request to this, via a header. Pushed
  // rather than read, because a `fetch` call is not inside a render tree and
  // cannot reach React state. Kept in an effect so it always reflects what is
  // actually on screen — including the fallback, before the list has loaded.
  useEffect(() => {
    setActiveWorkspaceId(active.id === FALLBACK.id ? null : active.id);
  }, [active.id]);

  const setKind = useCallback(
    (kind: Workspace) => {
      const found = list.find((w) => w.kind === kind);
      if (found) setActive(found.id);
    },
    [list, setActive],
  );

  const value = useMemo<Ctx>(
    () => ({
      workspaces: list,
      active,
      workspace: active.kind,
      workspaceId: active.id,
      workspaceName: active.name,
      role: active.role,
      isBusiness: active.kind === 'business',
      setActive,
      setKind,
      refresh,
    }),
    [list, active, setActive, setKind, refresh],
  );

  if (workspaces === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.ground, gap: space.lg }}>
        {failed ? (
          <>
            <Body strong>Could not load your workspaces</Body>
            <Button label="Try again" onPress={() => void refresh()} />
          </>
        ) : (
          <ActivityIndicator color={p.accent} />
        )}
      </View>
    );
  }

  // The one account shape personal-only can produce and must not crash on:
  // every workspace this person belongs to is a business, and business is
  // hidden. Falling through to `active.id === ''` here would spin forever —
  // nothing was ever going to arrive to fill it — so this is a real screen
  // instead, with the one action that actually resolves it.
  if (list.length === 0) {
    return <PersonalOnlyGate hadBusinessOnly={rawList.length > 0} refresh={refresh} setActive={setActive} />;
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  return useContext(WorkspaceContext);
}

/**
 * Shown when personal-only hides every workspace a person actually belongs
 * to — i.e. their account is business-only (an owner, or staff invited only
 * into the business, or the accountant's read-only seat). This is the case
 * most likely to break — a blank dashboard, or a silent bounce into
 * onboarding for someone who already has an account — so it gets its own
 * coherent screen rather than falling through to one built for a different
 * state.
 */
function PersonalOnlyGate({
  hadBusinessOnly,
  refresh,
  setActive,
}: {
  hadBusinessOnly: boolean;
  refresh: () => Promise<void>;
  setActive: (id: string) => void;
}) {
  const p = usePalette();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      const made = await api().createWorkspace('Personal', 'personal');
      await refresh();
      setActive(made.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set that up.');
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
        <Figure size="h1" style={{ textAlign: 'center' }}>
          {hadBusinessOnly ? 'This app tracks personal spending' : 'Set up your space'}
        </Figure>
        <Body muted style={{ textAlign: 'center' }}>
          {hadBusinessOnly
            ? 'Your account is set up for a business workspace, which is not part of Snap Apps right now. Start a personal space to track what you spend — it is entirely separate.'
            : 'Create a personal space to start tracking what you spend.'}
        </Body>
        {error ? (
          <Small muted={false} style={{ color: p.risk, textAlign: 'center' }}>
            {error}
          </Small>
        ) : null}
        <Button label="Set up personal tracking" onPress={() => void start()} busy={busy} />
      </View>
    </Screen>
  );
}

/**
 * The switch.
 *
 * Two workspaces get a segmented control, because that is the common case and
 * a tap beats a menu. More than two get a button that opens the full list —
 * a segmented control with five segments is unreadable on a phone.
 */
export function WorkspaceSwitch({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const { workspaces, active, setActive } = useWorkspace();
  const [picking, setPicking] = useState(false);

  if (workspaces.length <= 1) return null;

  if (workspaces.length === 2) {
    return (
      <View
        style={[
          {
            flexDirection: 'row',
            backgroundColor: p.surfaceAlt,
            borderRadius: radius.pill,
            padding: 3,
          },
          style,
        ]}
      >
        {workspaces.map((w) => {
          const on = w.id === active.id;
          return (
            <Pressable
              key={w.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${w.name} workspace`}
              onPress={() => setActive(w.id)}
              style={{
                flex: 1,
                paddingVertical: 7,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                backgroundColor: on ? p.accent : 'transparent',
                alignItems: 'center',
              }}
            >
              <Small
                muted={false}
                numberOfLines={1}
                style={{ color: on ? p.accentInk : p.inkMuted, fontWeight: '700' }}
              >
                {w.kind === 'business' ? 'Business' : 'Personal'}
              </Small>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${active.name}. Tap to switch.`}
        onPress={() => setPicking(true)}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: p.surfaceAlt,
            borderRadius: radius.pill,
            paddingVertical: 8,
            paddingHorizontal: space.md,
          },
          style,
        ]}
      >
        <Avatar initials={initials(active.name)} size={26} />
        <Body strong style={{ flex: 1 }} numberOfLines={1}>
          {active.name}
        </Body>
        <Icon name="chevronDown" size={16} color={p.inkMuted} />
      </Pressable>
      <WorkspacePicker open={picking} onClose={() => setPicking(false)} />
    </>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** The full list, with the option to start another one. */
export function WorkspacePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { workspaces, active, setActive, refresh } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Workspace>('personal');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function create() {
    setError(null);
    try {
      const made = await api().createWorkspace(name.trim(), BUSINESS_FEATURES_ENABLED ? kind : 'personal');
      await refresh();
      setActive(made.id);
      setCreating(false);
      setName('');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that workspace.');
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: p.overlay }}
        />
        <View
          style={{
            backgroundColor: p.ground,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: space.lg,
            paddingBottom: insets.bottom + space.lg,
            gap: space.md,
            maxHeight: '80%',
          }}
        >
          <Figure size="h1">Workspaces</Figure>
          <ScrollView contentContainerStyle={{ gap: space.sm }}>
            {workspaces.map((w) => {
              const on = w.id === active.id;
              return (
                <Pressable
                  key={w.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setActive(w.id);
                    onClose();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    padding: space.md,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: on ? p.accent : p.rule,
                    backgroundColor: on ? p.accentSoft : 'transparent',
                  }}
                >
                  <Avatar initials={initials(w.name)} size={38} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Body strong numberOfLines={1}>
                      {w.name}
                    </Body>
                    <Small>
                      {w.kind === 'business' ? 'Business' : 'Personal'} · {w.memberCount}{' '}
                      {w.memberCount === 1 ? 'person' : 'people'}
                    </Small>
                  </View>
                  {on ? <Chip tone="accent">Active</Chip> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Button
            label="New workspace"
            tone="outline"
            onPress={() => {
              setError(null);
              setCreating(true);
            }}
          />
        </View>
      </View>

      <Sheet
        open={creating}
        title="New workspace"
        subtitle="Its records and its people are entirely separate from your others."
        error={error}
        submitLabel="Create"
        submitDisabled={!name.trim()}
        onClose={() => setCreating(false)}
        onSubmit={create}
      >
        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Marsh Household"
          autoFocus
        />
        {BUSINESS_FEATURES_ENABLED ? (
          <View style={{ gap: space.sm }}>
            <Choice
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'personal', label: 'Personal' },
                { value: 'business', label: 'Business' },
              ]}
            />
            <Label>
              {kind === 'business'
                ? 'Tracks GST, tax invoices and a BAS position.'
                : 'Tracks budgets and spending. No tax, no GST, no ABN.'}
            </Label>
          </View>
        ) : (
          <Label>Tracks budgets and spending. No tax, no GST, no ABN.</Label>
        )}
      </Sheet>
    </Modal>
  );
}
