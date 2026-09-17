import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Raised } from '@/components/rich';
import { Body, Button, Figure, Label, Small } from '@/components/ui';
import { numeric, radius, space, type, usePalette } from '@/theme';

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
          gap: 4,
          borderWidth: 1.5,
          borderColor: focused ? p.accent : p.rule,
          backgroundColor: p.ground,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
        }}
      >
        {prefix ? <Text style={[type.body, numeric, { color: p.inkMuted }]}>{prefix}</Text> : null}
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
            type.body,
            keyboardType === 'decimal-pad' || keyboardType === 'number-pad' ? numeric : null,
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
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={{
                paddingHorizontal: space.md,
                paddingVertical: 9,
                borderRadius: radius.pill,
                backgroundColor: on ? p.accent : p.surfaceAlt,
              }}
            >
              <Text
                style={[
                  type.small,
                  { color: on ? p.accentInk : p.inkMuted, fontWeight: '700' },
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
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
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
    >
      <View style={{ flex: 1, gap: 1 }}>
        <Body strong>{label}</Body>
        {hint ? <Small>{hint}</Small> : null}
      </View>
      <View
        style={{
          width: 48,
          height: 28,
          borderRadius: 14,
          padding: 3,
          backgroundColor: value ? p.accent : p.ruleStrong,
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: '#FFFFFF',
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
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: space.lg,
            paddingHorizontal: space.lg,
            paddingBottom: insets.bottom + space.lg,
            gap: space.lg,
            maxHeight: '88%',
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: p.ruleStrong,
            }}
          />
          <View style={{ gap: 2 }}>
            <Figure size="h1">{title}</Figure>
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
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        paddingVertical: 13,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: pressed ? p.accent : p.ruleStrong,
        backgroundColor: pressed ? p.accentSoft : 'transparent',
      })}
    >
      <Text style={{ fontSize: 17, color: p.accent, fontWeight: '700' }}>＋</Text>
      <Body strong style={{ color: p.accent }}>
        {label}
      </Body>
    </Pressable>
  );
}

/** Shown while a screen's first load is in flight. */
export function Loading() {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={p.accent} />
    </View>
  );
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <Raised style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.xl }}>
      <Body strong>{title}</Body>
      <Small style={{ textAlign: 'center' }}>{detail}</Small>
    </Raised>
  );
}

/** Initials disc. The cheapest way to show who did something. */
export function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  const p = usePalette();
  // Hue from the initials so a person keeps the same colour everywhere,
  // without needing an avatar service or a stored preference.
  const hues = ['#1878D8', '#27AE60', '#9B6BF2', '#F2994A', '#EF6C7E', '#1CA8DB'];
  const hue = hues[(initials.charCodeAt(0) + (initials.charCodeAt(1) || 0)) % hues.length]!;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${hue}2E`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.38, fontWeight: '700', color: hue }}>{initials}</Text>
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
