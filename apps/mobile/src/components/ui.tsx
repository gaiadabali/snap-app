import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { PressableScale, useFill } from '@/components/motion';
import { control, font, numeric, radius, space, type, usePalette, useTheme } from '@/theme';
import { Text } from '@/theme/text';

/* Shared primitives — the instrument pass, 2026-10-19.

   Three rules carry the look, and every screen inherits them from here:

   1. STRUCTURE IS A HAIRLINE, NOT A BOX. Lists are ledger rows on the ground,
      divided by a 1px rule, under a mono label — not a stack of rounded cards.
      A `Card` still exists for the places a group genuinely needs an edge (a
      form, a notice, a choice), and it is a quiet one: surface fill, hairline
      border, 12pt corners, no shadow.
   2. TWO REGISTERS OF TYPE. Archivo for language, light when it is large;
      IBM Plex Mono for values and labels. Weight is spent once per row at
      most — a 500 title, everything else 400.
   3. ANYTHING PRESSABLE IS AT LEAST 44PT AND ANSWERS THE FINGER. Buttons and
      tappable rows give 3% and tick; nothing is a dead rectangle. */

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ flex: 1, backgroundColor: p.ground }, style]}>{children}</View>;
}

/** The mono label. Names a value or a group — not an eyebrow for every section. */
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
  level?: 'display' | 'h1' | 'h2' | 'h3';
  style?: StyleProp<TextStyle>;
}) {
  const p = usePalette();
  return <Text style={[type[level], { color: p.ink }, style]}>{children}</Text>;
}

/**
 * How each figure size is set. The large three are Archivo Light — a figure
 * that IS the screen reads as a headline. The small three are Plex Mono — a
 * figure in a row reads as a value in a column, and a column of them aligns.
 */
const FIGURE: Record<'hero' | 'display' | 'h1' | 'h2' | 'figure' | 'body' | 'small', TextStyle> = {
  hero: type.hero,
  display: { fontFamily: font.sans, fontSize: 34, lineHeight: 40, fontWeight: '300', letterSpacing: -1 },
  h1: { fontFamily: font.sans, fontSize: 28, lineHeight: 34, fontWeight: '300', letterSpacing: -0.8 },
  h2: { fontFamily: font.sans, fontSize: 22, lineHeight: 28, fontWeight: '400', letterSpacing: -0.5 },
  figure: type.figure,
  body: type.amount,
  small: { fontFamily: font.mono, fontSize: 13, lineHeight: 18, fontWeight: '400' },
};

/** Money and any other figure that lines up in a column. */
export function Figure({
  children,
  size = 'body',
  tone = 'ink',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: 'hero' | 'display' | 'h1' | 'h2' | 'figure' | 'body' | 'small';
  tone?: 'ink' | 'muted' | 'accent' | 'risk' | 'good' | 'onAccent';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
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
  return (
    <Text numberOfLines={numberOfLines} style={[FIGURE[size], numeric, { color: tones[tone] }, style]}>
      {children}
    </Text>
  );
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
  /** A firmer edge, for the one card on a screen that has to assert itself. */
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
    default: bordered ? p.ruleStrong : p.rule,
    ground: bordered ? p.ruleStrong : p.rule,
    accent: bordered ? p.accent : 'transparent',
    risk: p.riskRule,
    warn: bordered ? p.warn : 'transparent',
    good: bordered ? p.good : 'transparent',
  }[tone];
  return (
    <View
      style={[
        {
          backgroundColor: bg,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: border,
          padding: padded ? space.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * The square that holds an icon at the head of a row.
 *
 * An outline, not a pastel fill: the prototype tinted every one of these, and
 * forty tinted squares down a menu is the single loudest template tell in it.
 * The tone now lives in the glyph's colour. Risk keeps a fill, because a red
 * square is information.
 */
export function IconTile({
  name,
  tone = 'accent',
  size = 36,
}: {
  name: IconName;
  tone?: 'accent' | 'good' | 'warn' | 'risk' | 'neutral';
  size?: number;
}) {
  const p = usePalette();
  const map = {
    accent: { bg: 'transparent', fg: p.accentText, border: p.rule },
    good: { bg: 'transparent', fg: p.good, border: p.rule },
    warn: { bg: p.warnSoft, fg: p.warn, border: 'transparent' },
    risk: { bg: p.riskSoft, fg: p.risk, border: 'transparent' },
    neutral: { bg: 'transparent', fg: p.inkStrong, border: p.rule },
  }[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md,
        backgroundColor: map.bg,
        borderWidth: 1,
        borderColor: map.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={Math.round(size * 0.5)} color={map.fg} />
    </View>
  );
}

/**
 * Two things share this name, told apart by `onPress`.
 *
 * Without it, a STATUS BADGE: mono, uppercase, a soft fill — "CHECK", "DEMO",
 * "PAID". With it, a FILTER: sentence case on a hairline outline, inverted to
 * ink when selected. The prototype drew both as the same blue pill, so a
 * status and a control looked identical.
 */
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
    neutral: { bg: p.surfaceAlt, fg: p.inkStrong },
    accent: { bg: p.accentSoft, fg: p.accentText },
    risk: { bg: p.riskSoft, fg: p.risk },
    warn: { bg: p.warnSoft, fg: p.warn },
    good: { bg: p.goodSoft, fg: p.good },
  }[tone];

  if (!onPress) {
    // The outer row is what lets one badge sit right everywhere: in a column
    // it stops the badge stretching to full width, and in a row it lets the
    // parent's `alignItems` centre it rather than pinning it to the top.
    return (
      <View style={{ flexDirection: 'row' }}>
        <View
          style={{
            backgroundColor: selected ? p.ink : map.bg,
            paddingHorizontal: 6,
            paddingVertical: 3,
            borderRadius: radius.xs,
          }}
        >
          <Text
            style={[
              type.label,
              { fontSize: 10, lineHeight: 12, letterSpacing: 1, color: selected ? p.ground : map.fg },
            ]}
          >
            {children}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      hitSlop={6}
      accessibilityState={{ selected: !!selected }}
      style={{
        minHeight: 34,
        justifyContent: 'center',
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: selected ? p.ink : p.rule,
        backgroundColor: selected ? p.ink : 'transparent',
      }}
    >
      <Text style={[type.smallStrong, { color: selected ? p.ground : p.inkStrong }]}>{children}</Text>
    </PressableScale>
  );
}

/**
 * One choice from a short, fixed set — a period, a range, a view.
 *
 * A segmented control rather than a row of chips when the options are few
 * and always all visible: it reads as one control with a setting, which is
 * what it is.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          padding: 3,
          borderRadius: radius.md,
          backgroundColor: p.surface,
          borderWidth: 1,
          borderColor: p.rule,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            scaleTo={0.98}
            containerStyle={{ flex: 1 }}
            style={{
              minHeight: 34,
              borderRadius: radius.sm + 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.sm,
              backgroundColor: on ? p.ground : 'transparent',
              borderWidth: on ? 1 : 0,
              borderColor: p.ruleStrong,
            }}
          >
            <Text
              numberOfLines={1}
              style={[type.smallStrong, { color: on ? p.ink : p.inkMuted }]}
            >
              {o.label}
            </Text>
          </PressableScale>
        );
      })}
    </View>
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
  size = 'md',
}: {
  label: string;
  onPress: () => void;
  tone?: 'accent' | 'outline' | 'risk' | 'ghost';
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** `sm` is the inline action in a row — "Edit", "Switch". Still 44pt of
   *  target via hit slop; only the drawn box is smaller. */
  size?: 'md' | 'sm';
}) {
  const sm = size === 'sm';
  const { scheme } = useTheme();
  const p = usePalette();
  const bg = { accent: p.accent, outline: 'transparent', ghost: 'transparent', risk: p.risk }[tone];
  const pressedBg = {
    accent: p.accentDeep,
    outline: p.surface,
    ghost: p.accentSoft,
    risk: p.risk,
  }[tone];
  const fg = {
    accent: p.accentInk,
    outline: p.ink,
    ghost: p.accentText,
    // Dark ink on the dark scheme's risk, which is a light salmon: white on it
    // measured well under 3:1.
    risk: scheme === 'dark' ? p.ground : '#FFFFFF',
  }[tone];
  const off = disabled || busy;
  return (
    <PressableScale
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={off ? undefined : onPress}
      haptic={tone === 'accent' || tone === 'risk' ? 'light' : 'select'}
      scaleTo={0.98}
      hitSlop={sm ? 6 : undefined}
      containerStyle={style}
      style={{
        minHeight: sm ? 34 : control.button,
        backgroundColor: bg,
        borderColor: tone === 'outline' ? p.ruleStrong : bg,
        borderWidth: tone === 'outline' ? 1 : 0,
        borderRadius: sm ? radius.sm + 2 : radius.md,
        paddingVertical: sm ? 6 : space.md,
        paddingHorizontal: sm ? 14 : space.xl,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.45 : 1,
        flexDirection: 'row',
        gap: 9,
      }}
      pressedStyle={{ backgroundColor: pressedBg }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : null}
      {!busy && icon ? <Icon name={icon} size={19} color={fg} /> : null}
      <Text style={[sm ? type.smallStrong : type.bodyStrong, { color: fg, letterSpacing: 0.1 }]}>
        {label}
      </Text>
    </PressableScale>
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
      hitSlop={4}
      style={({ pressed }) => [
        {
          minWidth: control.tap,
          minHeight: control.tap,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.5 : 1,
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
    info: { bg: p.infoSoft, fg: p.accentText, ink: p.info, edge: p.accent },
    good: { bg: p.goodSoft, fg: p.good, ink: p.goodInk, edge: p.good },
    warn: { bg: p.warnSoft, fg: p.warn, ink: p.warnInk, edge: p.warn },
    risk: { bg: p.riskSoft, fg: p.risk, ink: p.riskInk, edge: p.risk },
  }[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: map.bg,
          borderRadius: radius.lg,
          borderLeftWidth: 2,
          borderLeftColor: map.edge,
          paddingVertical: space.md,
          paddingLeft: 14,
          paddingRight: onDismiss ? 4 : space.lg,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={map.fg} /> : null}
      <Text style={[type.small, { flex: 1, color: map.ink }]}>{children}</Text>
      {onDismiss ? (
        <IconButton name="close" label="Dismiss" onPress={onDismiss} size={16} color={map.fg} />
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
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
      }}
    >
      {icon ? <IconTile name={icon} tone={danger ? 'risk' : iconTone ?? 'neutral'} /> : null}
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
      {onPress && chevron ? <Icon name="chevronRight" size={16} color={p.inkFaint} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? p.surface : 'transparent' })}
    >
      {body}
    </Pressable>
  );
}

/**
 * A group on the page: a mono label, an optional action at the far end, and
 * whatever the group holds underneath. No box — the label and the hairline
 * under it are the edge.
 */
export function Section({
  label,
  action,
  children,
  style,
  rule = true,
}: {
  label: string;
  action?: { label: string; onPress: () => void };
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The hairline under the label. Off when the content draws its own top edge. */
  rule?: boolean;
}) {
  const p = usePalette();
  return (
    <View style={style}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 32,
          paddingBottom: space.sm,
          borderBottomWidth: rule ? 1 : 0,
          borderBottomColor: p.rule,
        }}
      >
        <Label>{label}</Label>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
          >
            <Text style={[type.smallStrong, { color: p.accentText }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The ledger row — the workhorse of every list.
 *
 * A narrow mono gutter (a date, a code, a count), a title and an optional
 * note, and a right-locked mono figure. Rows are divided by a hairline, the
 * first one excepted, and sit directly on the ground: a list of receipts is a
 * ledger, and it is drawn as one rather than as a deck of cards.
 */
export function LedgerRow({
  gutter,
  lead,
  title,
  note,
  figure,
  figureTone = 'ink',
  trailing,
  onPress,
  first,
  accessibilityLabel,
}: {
  /** Up to ~6 mono characters: "16 SEP", "G11", "×3". */
  gutter?: string;
  /** A leading element in place of the gutter — a category mark, an avatar. */
  lead?: ReactNode;
  title: string;
  note?: ReactNode;
  figure?: string;
  figureTone?: 'ink' | 'muted' | 'accent' | 'risk' | 'good';
  trailing?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  const tones = {
    ink: p.ink,
    muted: p.inkMuted,
    accent: p.accentText,
    risk: p.risk,
    good: p.good,
  };
  const body = (pressed: boolean) => (
    <View
      style={{
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.md,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
        backgroundColor: pressed ? p.surface : 'transparent',
      }}
    >
      {gutter !== undefined ? (
        <Text style={[type.mono, numeric, { width: 50, color: p.inkMuted, letterSpacing: 0.4 }]}>
          {gutter}
        </Text>
      ) : null}
      {lead}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[type.bodyStrong, { color: p.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {typeof note === 'string' ? (
          <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={1}>
            {note}
          </Text>
        ) : (
          note
        )}
      </View>
      {trailing}
      {figure !== undefined ? (
        <Text style={[type.amount, numeric, { color: tones[figureTone] }]}>{figure}</Text>
      ) : null}
    </View>
  );
  if (!onPress) return body(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/**
 * Back arrow plus a title, which is what almost every pushed screen opens
 * with. These screens run `headerShown: false` and this stands in — one place
 * to get the 44pt target and the -10 optical inset right instead of thirty.
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
    <View style={{ gap: space.xs }}>
      {onBack ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton name="back" label="Back" onPress={onBack} style={{ marginLeft: -11 }} size={22} />
          {trailing}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <Text style={[type.h1, { flex: 1, color: p.ink }]} numberOfLines={2}>
          {title}
        </Text>
        {!onBack ? trailing : null}
      </View>
    </View>
  );
}

/** A horizontal rule that respects the palette. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ height: 1, backgroundColor: p.rule }, style]} />;
}

/** "or continue as" — a rule with a caption sitting in the gap. */
export function DividerLabel({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, height: 1, backgroundColor: p.rule }} />
      <Text style={[type.label, { color: p.inkFaint }]}>{children}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: p.rule }} />
    </View>
  );
}

/**
 * A meter. Used for budgets, goals and onboarding steps.
 *
 * It draws in from zero to the measured value — the motion is the reading
 * being taken — and an optional `marker` places a hairline tick at a second
 * value, such as how far through the month today is.
 */
export function ProgressBar({
  value,
  tone,
  height = 4,
  marker,
  track,
  markerColor,
}: {
  /** 0–1. Clamped, so an over-budget category still renders a full bar. */
  value: number;
  tone?: string;
  height?: number;
  /** 0–1. A tick at a reference point. */
  marker?: number;
  /** Track colour override, for a meter sitting on the void panel. */
  track?: string;
  /** The marker's colour. Defaults to ink; pass `voidInk` on the panel. */
  markerColor?: string;
}) {
  const p = usePalette();
  const pct = Math.max(0, Math.min(1, value));
  const fill = useFill(pct);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
      style={{ height: Math.max(height, marker !== undefined ? height + 8 : height), justifyContent: 'center' }}
    >
      <View
        style={{
          height,
          borderRadius: height / 2,
          backgroundColor: track ?? p.surfaceAlt,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            { height: '100%', borderRadius: height / 2, backgroundColor: tone ?? p.accent },
            fill,
          ]}
        />
      </View>
      {marker !== undefined ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${Math.max(0, Math.min(1, marker)) * 100}%`,
            top: 0,
            bottom: 0,
            width: 1.5,
            marginLeft: -0.75,
            backgroundColor: markerColor ?? p.ink,
          }}
        />
      ) : null}
    </View>
  );
}

/** Confidence expressed as form, not just a number — three indicator lamps. */
export function ConfidenceDots({ value }: { value: number }) {
  const p = usePalette();
  const filled = value >= 0.95 ? 3 : value >= 0.85 ? 2 : 1;
  const tone = filled === 3 ? p.good : filled === 2 ? p.warn : p.risk;
  return (
    <View
      style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}
      accessibilityLabel={`Confidence ${Math.round(value * 100)} percent`}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 5,
            height: 9,
            borderRadius: 1,
            backgroundColor: i < filled ? tone : p.ruleStrong,
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
          height: 6,
          borderRadius: 3,
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
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}
