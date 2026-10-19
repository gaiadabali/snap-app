import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { Text, TextInput } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';

import { PressableScale, tick } from '@/components/motion';
import { Body, Button, Figure, Label, Small, Title } from '@/components/ui';
import { elevation, numeric, radius, space, type, usePalette } from '@/theme';

/**
 * Form primitives.
 *
 * Written once because fourteen screens need to add something — a category, a
 * trip, a goal, a member, an item, a contact — and a form assembled freehand
 * on each of them is fourteen chances to disagree about where the error
 * message goes.
 *
 * Every sheet here follows the same rule: the action button is disabled until
 * the form could succeed, and a failure from the API is shown in the sheet
 * rather than thrown away, because the API is where the real validation lives
 * (a duplicate name, a seat limit, an ABN checksum) and the screen cannot
 * know those answers in advance.
 */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  hint,
  prefix,
  autoFocus,
  autoCapitalize = 'sentences',
  multiline,
  secureTextEntry,
  autoComplete,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  hint?: string;
  prefix?: string;
  autoFocus?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  multiline?: boolean;
  /** Masks the input. Also turns off the keyboard's learning of what is typed. */
  secureTextEntry?: boolean;
  /**
   * What the platform password manager should offer here.
   *
   * Worth setting rather than leaving to inference: this build has NO password
   * reset (migration 0025), so a password the keychain saved correctly is the
   * difference between a tester signing in tomorrow and an account nobody can
   * recover. `new-password` on the register field also stops the OS offering
   * the address as the password.
   */
  autoComplete?: 'email' | 'current-password' | 'new-password' | 'name' | 'off';
}) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: multiline ? undefined : 50,
          // 1px at rest, 2px focused — the extra pixel comes out of the
          // padding so the text inside does not shift when focus lands.
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? p.accent : p.ruleStrong,
          backgroundColor: p.ground,
          borderRadius: radius.md,
          paddingHorizontal: focused ? 13 : 14,
        }}
      >
        {prefix ? <Text style={[type.amount, numeric, { color: p.inkMuted }]}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={p.inkFaint}
          autoFocus={autoFocus}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          secureTextEntry={secureTextEntry}
          autoComplete={autoComplete}
          // A password field must never feed the keyboard's dictionary: the
          // next person typing in any app would be offered it as a suggestion.
          keyboardType={secureTextEntry ? 'default' : keyboardType}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            keyboardType === 'decimal-pad' || keyboardType === 'number-pad'
              ? [type.amount, { fontSize: 16 }, numeric]
              : type.input,
            {
              flex: 1,
              color: p.ink,
              paddingVertical: 12,
              minHeight: multiline ? 80 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}

/** A row of mutually exclusive choices. Used wherever a picker would be overkill. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Label>{label}</Label> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <PressableScale
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: 38,
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: on ? p.ink : p.ruleStrong,
                backgroundColor: on ? p.ink : 'transparent',
              }}
            >
              <Text style={[type.smallStrong, { color: on ? p.ground : p.inkStrong }]}>
                {o.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={() => {
        tick();
        onChange(!value);
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Body strong>{label}</Body>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      {/* A squared switch, not a pill — 46x28 on a 7pt radius with a square
          knob, so it reads as a hardware toggle on this app's instrument
          register rather than as iOS chrome dropped into an Android build. */}
      <View
        style={{
          width: 46,
          height: 28,
          borderRadius: 7,
          padding: 3,
          backgroundColor: value ? p.accent : p.surfaceAlt,
          borderWidth: 1,
          borderColor: value ? p.accent : p.ruleStrong,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            borderRadius: 5,
            backgroundColor: value ? '#FFFFFF' : p.ground,
            borderWidth: value ? 0 : 1,
            borderColor: p.ruleStrong,
            alignSelf: value ? 'flex-end' : 'flex-start',
          }}
        />
      </View>
    </Pressable>
  );
}

/**
 * A bottom sheet holding a short form.
 *
 * Bottom rather than centred because it is reachable one-handed, which matters
 * for something used at a service station counter.
 */
export function Sheet({
  open,
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled,
  children,
  error,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitDisabled?: boolean;
  children: ReactNode;
  error?: string | null;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ flex: 1, backgroundColor: p.overlay }}
        />
        <View
          style={{
            backgroundColor: p.ground,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: p.rule,
            ...elevation.float,
            paddingTop: 10,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.lg,
            gap: space.lg,
            maxHeight: '88%',
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: p.ruleStrong,
            }}
          />
          <View style={{ gap: 4 }}>
            <Title level="h2">{title}</Title>
            {subtitle ? <Small>{subtitle}</Small> : null}
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: space.lg, paddingBottom: space.sm }}
          >
            {children}
            {error ? (
              <View
                style={{
                  backgroundColor: p.riskSoft,
                  borderRadius: radius.md,
                  borderLeftWidth: 2,
                  borderLeftColor: p.risk,
                  padding: space.md,
                }}
              >
                <Small muted={false} style={{ color: p.risk }}>
                  {error}
                </Small>
              </View>
            ) : null}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Cancel" tone="outline" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label={submitLabel}
              onPress={() => void submit()}
              busy={busy}
              disabled={submitDisabled}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The button that opens an add-sheet. Present on every list that can grow. */
export function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        minHeight: 48,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: p.ruleStrong,
      }}
      pressedStyle={{ backgroundColor: p.surface }}
    >
      <Icon name="plus" size={17} color={p.accentText} />
      <Body strong style={{ color: p.accentText }}>
        {label}
      </Body>
    </PressableScale>
  );
}

/** Shown while a screen's first load is in flight. */
export function Loading() {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={p.inkMuted} />
    </View>
  );
}

/**
 * An empty list, drawn as the outline of where the list will be: a dashed
 * edge is the honest picture of "nothing here yet", and the copy says what
 * to do about it.
 */
export function Empty({ title, detail }: { title: string; detail: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        alignItems: 'center',
        gap: space.xs,
        paddingVertical: space.xl,
        paddingHorizontal: space.lg,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: p.ruleStrong,
      }}
    >
      <Body strong>{title}</Body>
      <Small style={{ textAlign: 'center' }}>{detail}</Small>
    </View>
  );
}

/** Initials disc. The cheapest way to show who did something. */
export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  const p = usePalette();
  // Monochrome on purpose. The prototype gave every person a pastel hue from
  // their initials, so a list of five people was five competing colours that
  // meant nothing; the initials in mono on a quiet disc say who it is.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.surface,
        borderWidth: 1,
        borderColor: p.ruleStrong,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={[
          type.mono,
          {
            fontSize: Math.round(size * 0.34),
            lineHeight: Math.round(size * 0.42),
            fontWeight: '500',
            color: p.inkStrong,
            letterSpacing: 0.5,
          },
        ]}
      >
        {initials}
      </Text>
    </View>
  );
}

/** A labelled figure in a row of them. */
export function StatRow({ stats }: { stats: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.lg }}>
      {stats.map((s) => (
        <View key={s.label} style={{ flex: 1, gap: 2 }}>
          <Label>{s.label}</Label>
          <Figure size="h2">{s.value}</Figure>
          {s.hint ? <Small numberOfLines={1}>{s.hint}</Small> : null}
        </View>
      ))}
    </View>
  );
}
