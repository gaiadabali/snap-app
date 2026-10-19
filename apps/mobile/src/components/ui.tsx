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

import { Icon, type IconName } from '@/components/Icon';
import { control, numeric, radius, space, type, usePalette } from '@/theme';

/* Shared primitives, rebuilt against the 2026-09-19 prototype.

   Two rules carry most of the look, and both are worth keeping:

   1. A card is a FILL, not a box. The prototype almost never draws a border —
      `surface` against `ground` is enough separation, and dropping the outline
      is what stops a dense screen reading as a spreadsheet. Borders are
      reserved for inputs (where the edge means "type here") and for the one
      or two places a card has to assert itself.
   2. Anything pressable is at least `control.tap` (44) high, and a primary
      button is `control.button` (52). The prototype is rigid about this and
      it is why it feels like an app rather than a web page. */

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ flex: 1, backgroundColor: p.ground }, style]}>{children}</View>;
}

export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return <Text style={[type.label, { color: p.inkMuted }, style]}>{children}</Text>;
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

/** A screen or section heading. */
export function Title({
  children,
  level = 'h1',
  style,
}: {
  children: ReactNode;
  level?: 'h1' | 'h2' | 'h3';
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  return <Text style={[type[level], { color: p.ink }, style]}>{children}</Text>;
}

/** Money and any other figure that lines up in a column. */
export function Figure({
  children,
  size = 'body',
  tone = 'ink',
  style,
}: {
  children: ReactNode;
  size?: 'hero' | 'display' | 'h1' | 'h2' | 'figure' | 'body' | 'small';
  tone?: 'ink' | 'muted' | 'accent' | 'risk' | 'good' | 'onAccent';
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  const tones = {
    ink: p.ink,
    muted: p.inkMuted,
    accent: p.accentText,
    risk: p.risk,
    good: p.good,
    onAccent: '#FFFFFF',
  };
  return <Text style={[type[size], numeric, { color: tones[tone] }, style]}>{children}</Text>;
}

export function Card({
  children,
  style,
  tone = 'default',
  bordered = false,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'ground' | 'accent' | 'risk' | 'warn' | 'good';
  /** Opt in where the card has to separate from a same-coloured neighbour. */
  bordered?: boolean;
  padded?: boolean;
}) {
  const p = usePalette();
  const bg = {
    default: p.surface,
    ground: p.ground,
    accent: p.accentSoft,
    risk: p.riskSoft,
    warn: p.warnSoft,
    good: p.goodSoft,
  }[tone];
  const border = {
    default: p.rule,
    ground: p.rule,
    accent: p.accent,
    risk: p.riskRule,
    warn: p.warn,
    good: p.good,
  }[tone];
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.xl,
          padding: padded ? space.lg : 0,
        },
        bordered && { borderColor: border, borderWidth: StyleSheet.hairlineWidth * 2 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The rounded square that holds an icon at the head of a row or a feature
 * bullet. Accent-tinted by default, which is how the prototype uses it.
 */
export function IconTile({
  name,
  tone = 'accent',
  size = 40,
}: {
  name: IconName;
  tone?: 'accent' | 'good' | 'warn' | 'risk' | 'neutral';
  size?: number;
}) {
  const p = usePalette();
  const map = {
    accent: { bg: p.accentSoft, fg: p.accentText },
    good: { bg: p.goodSoft, fg: p.good },
    warn: { bg: p.warnSoft, fg: p.warn },
    risk: { bg: p.riskSoft, fg: p.risk },
    neutral: { bg: p.surfaceAlt, fg: p.inkMuted },
  }[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: map.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={Math.round(size * 0.575)} color={map.fg} />
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
  tone?: 'neutral' | 'accent' | 'risk' | 'warn' | 'good';
  onPress?: () => void;
  selected?: boolean;
}) {
  const p = usePalette();
  const map = {
    neutral: { bg: p.surfaceAlt, fg: p.inkMuted },
    accent: { bg: p.accentSoft, fg: p.accentText },
    risk: { bg: p.riskSoft, fg: p.risk },
    warn: { bg: p.warnSoft, fg: p.warn },
    good: { bg: p.goodSoft, fg: p.good },
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
      <Text style={[type.smallStrong, { color: selected ? p.accentInk : map.fg }]}>{children}</Text>
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
  icon,
  busy,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'outline' | 'risk' | 'ghost';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const bg = { accent: p.accent, outline: 'transparent', ghost: 'transparent', risk: p.risk }[tone];
  const fg = {
    accent: p.accentInk,
    outline: p.ink,
    ghost: p.accentText,
    risk: '#FFFFFF',
  }[tone];
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: control.button,
          backgroundColor: bg,
          borderColor: tone === 'outline' ? p.ruleStrong : bg,
          borderWidth: tone === 'outline' ? 1.5 : 0,
          borderRadius: radius.md,
          paddingVertical: space.md,
          paddingHorizontal: space.xl,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
          flexDirection: 'row',
          gap: 9,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      {!busy && icon ? <Icon name={icon} size={21} color={fg} /> : null}
      <Text style={[type.bodyStrong, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** A 44×44 borderless press target holding one icon — back, close, dismiss. */
export function IconButton({
  name,
  onPress,
  label,
  color,
  size = 21,
  style,
}: {
  name: IconName;
  onPress: () => void;
  /** Required: an icon alone tells a screen reader nothing. */
  label: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minWidth: control.tap,
          minHeight: control.tap,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? p.ink} />
    </Pressable>
  );
}

/**
 * A coloured message block — the offline banner, a wrong-code warning, a
 * "checked and filed" confirmation. `tone` picks the fill, the icon tint and
 * the text colour as one set, so they can never drift apart.
 */
export function Notice({
  children,
  tone = 'info',
  icon,
  onDismiss,
  style,
}: {
  children: ReactNode;
  tone?: 'info' | 'good' | 'warn' | 'risk';
  icon?: IconName;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const map = {
    info: { bg: p.infoSoft, fg: p.accentText, ink: p.info },
    good: { bg: p.goodSoft, fg: p.good, ink: p.goodInk },
    warn: { bg: p.warnSoft, fg: p.warn, ink: p.warnInk },
    risk: { bg: p.riskSoft, fg: p.risk, ink: p.riskInk },
  }[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          backgroundColor: map.bg,
          borderRadius: radius.lg,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={20} color={map.fg} /> : null}
      <Text style={[type.small, { flex: 1, color: map.ink }]}>{children}</Text>
      {onDismiss ? (
        <IconButton name="close" label="Dismiss" onPress={onDismiss} size={17} color={map.fg} />
      ) : null}
    </View>
  );
}

/**
 * A tappable list row: optional leading icon, a title, optional supporting
 * line, optional trailing text, and a chevron when it navigates.
 */
export function Row({
  title,
  subtitle,
  icon,
  iconTone,
  trailing,
  onPress,
  chevron = true,
  danger,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconTone?: 'accent' | 'good' | 'warn' | 'risk' | 'neutral';
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  const p = usePalette();
  const body = (
    <View
      style={{
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
      }}
    >
      {icon ? <IconTile name={icon} tone={danger ? 'risk' : iconTone ?? 'accent'} size={40} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: danger ? p.risk : p.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress && chevron ? <Icon name="chevronRight" size={18} color={p.inkFaint} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/**
 * Back arrow plus a title, which is what almost every pushed screen in the
 * redesign opens with. The prototype draws its own rather than using the
 * navigator's header, so these screens run `headerShown: false` and this
 * stands in — one place to get the 44pt target and the -10 optical inset
 * right instead of thirty.
 */
export function ScreenHeader({
  title,
  onBack,
  trailing,
}: {
  title: string;
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      {onBack ? (
        <IconButton name="back" label="Back" onPress={onBack} style={{ marginLeft: -10 }} />
      ) : null}
      <Text style={[type.h1, { flex: 1, fontSize: 24, lineHeight: 30, color: p.ink }]} numberOfLines={1}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

/** A horizontal rule that respects the palette. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth * 2, backgroundColor: p.rule }, style]} />;
}

/** "or continue as" — a rule with a caption sitting in the gap. */
export function DividerLabel({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: p.rule }} />
      <Text style={[type.small, { color: p.inkMuted }]}>{children}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: p.rule }} />
    </View>
  );
}

/** A filled track. Used for budgets, goals and onboarding step dots. */
export function ProgressBar({
  value,
  tone,
  height = 8,
}: {
  /** 0–1. Clamped, so an over-budget category still renders a full bar. */
  value: number;
  tone?: string;
  height?: number;
}) {
  const p = usePalette();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
      style={{
        height,
        borderRadius: radius.pill,
        backgroundColor: p.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          borderRadius: radius.pill,
          backgroundColor: tone ?? p.accent,
        }}
      />
    </View>
  );
}

/** Confidence expressed as form, not just a number — scannable at a glance. */
export function ConfidenceDots({ value }: { value: number }) {
  const p = usePalette();
  const filled = value >= 0.95 ? 3 : value >= 0.85 ? 2 : 1;
  const tone = filled === 3 ? p.good : filled === 2 ? p.warn : p.risk;
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
