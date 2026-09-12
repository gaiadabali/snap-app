import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { numeric, radius, space, type, usePalette } from '@/theme';

/* Shared primitives. Border, fill and shadow are spent by role rather than
   stamped on every block — a card here means "this is a distinct object", not
   "this is content". */

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ flex: 1, backgroundColor: p.ground }, style]}>{children}</View>;
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return <Text style={[type.label, { color: p.inkFaint }, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  strong,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  strong?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const p = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[strong ? type.bodyStrong : type.body, { color: muted ? p.inkMuted : p.ink }, style]}
    >
      {children}
    </Text>
  );
}

export function Small({
  children,
  muted = true,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const p = usePalette();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[type.small, { color: muted ? p.inkMuted : p.ink }, style]}
    >
      {children}
    </Text>
  );
}

/** Money and any other figure that lines up in a column. */
export function Figure({
  children,
  size = 'body',
  tone = 'ink',
  style,
}: {
  children: ReactNode;
  size?: 'display' | 'h1' | 'h2' | 'body' | 'small';
  tone?: 'ink' | 'muted' | 'accent' | 'risk';
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  const tones = { ink: p.ink, muted: p.inkMuted, accent: p.accent, risk: p.risk };
  return <Text style={[type[size], numeric, { color: tones[tone] }, style]}>{children}</Text>;
}

export function Card({
  children,
  style,
  tone = 'default',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'accent' | 'risk';
}) {
  const p = usePalette();
  const bg = { default: p.surface, accent: p.accentSoft, risk: p.riskSoft }[tone];
  const border = { default: p.rule, accent: p.accent, risk: p.risk }[tone];
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.lg,
          padding: space.lg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  onPress,
  selected,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'risk' | 'warn';
  onPress?: () => void;
  selected?: boolean;
}) {
  const p = usePalette();
  const map = {
    neutral: { bg: p.surfaceAlt, fg: p.inkMuted },
    accent: { bg: p.accentSoft, fg: p.accent },
    risk: { bg: p.riskSoft, fg: p.risk },
    warn: { bg: p.warnSoft, fg: p.warn },
  }[tone];
  const content = (
    <View
      style={{
        backgroundColor: selected ? p.accent : map.bg,
        paddingHorizontal: space.md,
        paddingVertical: 5,
        borderRadius: radius.pill,
      }}
    >
      <Text style={[type.small, { color: selected ? p.accentInk : map.fg, fontWeight: '600' }]}>
        {children}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={6}>
      {content}
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  tone = 'accent',
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'outline' | 'risk';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const isOutline = tone === 'outline';
  const bg = isOutline ? 'transparent' : tone === 'risk' ? p.risk : p.accent;
  const fg = isOutline ? p.ink : p.accentInk;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderColor: isOutline ? p.ruleStrong : bg,
          borderWidth: isOutline ? StyleSheet.hairlineWidth * 2 : 0,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: space.xl,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          flexDirection: 'row',
          gap: space.sm,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      <Text style={[type.bodyStrong, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A horizontal rule that respects the palette. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: p.rule }, style]} />;
}

/** Confidence expressed as form, not just a number — scannable at a glance. */
export function ConfidenceDots({ value }: { value: number }) {
  const p = usePalette();
  const filled = value >= 0.95 ? 3 : value >= 0.85 ? 2 : 1;
  const tone = filled === 3 ? p.accent : filled === 2 ? p.warn : p.risk;
  return (
    <View
      style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }}
      accessibilityLabel={`Confidence ${Math.round(value * 100)} percent`}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i < filled ? tone : p.rule,
          }}
        />
      ))}
    </View>
  );
}

/** Progress against a range, used for deductions vs occupation benchmark. */
export function RangeBar({
  value,
  low,
  high,
  max,
}: {
  value: number;
  low: number;
  high: number;
  max: number;
}) {
  const p = usePalette();
  const pct = (n: number): `${number}%` =>
    `${Math.max(0, Math.min(100, (n / max) * 100))}%`;
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          height: 10,
          borderRadius: radius.pill,
          backgroundColor: p.surfaceAlt,
          overflow: 'hidden',
        }}
      >
        {/* The typical band for this occupation, drawn behind the actual value. */}
        <View
          style={{
            position: 'absolute',
            left: pct(low),
            width: pct(high - low),
            top: 0,
            bottom: 0,
            backgroundColor: p.accentSoft,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            width: pct(value),
            top: 0,
            bottom: 0,
            backgroundColor: p.accent,
            borderRadius: radius.pill,
          }}
        />
      </View>
    </View>
  );
}
