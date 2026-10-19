import { createContext, useContext, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Settle } from '@/components/motion';
import { hueFor, numeric, onVoid, radius, space, type, usePalette, useTheme } from '@/theme';
import { Text } from '@/theme/text';

/**
 * The richer surface of the design system — rebuilt in the instrument pass.
 *
 * This file used to hold the prototype's "vibrant" layer: a three-stop blue
 * gradient hero with two translucent circles floating in it "echoing the
 * gloss of the teaser's 3D sphere", tinted discs behind every category icon,
 * and cards lifted on drop shadows. Each was reasonable alone; together they
 * were the generated-fintech look the owner called slop, and they had spread
 * to twenty-five screens through the components below.
 *
 * What replaced them keeps every export name, so no screen had to change to
 * pick it up:
 *   - `GradientHero` is now the VOID PANEL — flat, near-black in both
 *     schemes, no gradient and nothing floating in it. The headline figure is
 *     set in Archivo Light on it. It is the one inverted element on a screen.
 *   - `CategoryIcon` is a small square mark, not a pastel disc.
 *   - `Raised` is a card with a hairline edge, not a shadow.
 */

/* ── Category colour ───────────────────────────────────────────────────────
   One hue per category so the eye can sort a list before reading a word.
   Business categories are held locally on the same hue range, so the two
   workspaces never look like the same data reordered. */
const CATEGORY: Record<string, { hue: string; ink: string; icon: IconName }> = {
  Fuel: { hue: '#F2994A', ink: '#9A5A12', icon: 'fuel' },
  'Meals on the road': { hue: '#EF6C7E', ink: '#B8384C', icon: 'fork' },
  Accommodation: { hue: '#9B6BF2', ink: '#7A46D8', icon: 'bag' },
  'Truck parts & maintenance': { hue: '#2D9CDB', ink: '#1A6E9E', icon: 'cog' },
  Tolls: { hue: '#1CA8DB', ink: '#116C8C', icon: 'fuel' },
  'Phone & internet': { hue: '#5B6EF5', ink: '#4453C9', icon: 'bolt' },
  'Protective clothing': { hue: '#27AE60', ink: '#1B7A43', icon: 'shield' },
  'Truck cleaning supplies': { hue: '#4FC3C7', ink: '#2A8286', icon: 'spark' },
  Insurance: { hue: '#6C8AE4', ink: '#4A64B8', icon: 'shield' },
  'Laundry on the road': { hue: '#E876B8', ink: '#A6407C', icon: 'bag' },
};

/** Icon per personal category. Hue and ink come from the theme's `hueFor`. */
const PERSONAL_ICON: Record<string, IconName> = {
  Groceries: 'cart',
  'Eating out': 'fork',
  Transport: 'fuel',
  'Bills & utilities': 'bolt',
  Health: 'heart',
  Shopping: 'bag',
  Home: 'home',
  'Home & garden': 'home',
  Fun: 'spark',
};

export function categoryHue(category: string): string {
  return CATEGORY[category]?.hue ?? hueFor(category).hue;
}

/**
 * The category's mark at the head of a row.
 *
 * A rounded square with a hairline in the category's own hue and the glyph in
 * its ink — enough colour to sort a list by, and none of the pastel fill that
 * made every row look like a sticker. Was a tinted disc, and before that an
 * emoji, which rendered as a blank box on several Android builds.
 */
export function CategoryIcon({ category, size = 36 }: { category: string; size?: number }) {
  const { scheme } = useTheme();
  const business = CATEGORY[category];
  const personal = hueFor(category, scheme);
  const hue = business?.hue ?? personal.hue;
  const ink = scheme === 'dark' ? personal.ink : business?.ink ?? personal.ink;
  const icon = business?.icon ?? PERSONAL_ICON[category] ?? 'tag';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        backgroundColor: `${hue}${scheme === 'dark' ? '1F' : '17'}`,
        borderWidth: 1,
        borderColor: `${hue}${scheme === 'dark' ? '55' : '40'}`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} color={ink} />
    </View>
  );
}

/** A category's colour as a small square swatch — for legends and notes. */
export function CategorySwatch({ category, size = 8 }: { category: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: 2, backgroundColor: categoryHue(category) }}
    />
  );
}

/* ── The void panel ─────────────────────────────────────────────────────── */

const PanelTone = createContext<'brand' | 'risk'>('brand');

/**
 * The headline panel. Carries the one figure that answers "am I okay?".
 *
 * Exported under its old name, `GradientHero`, so the twenty-five screens
 * that use it moved in one change; `Instrument` is the name to write in new
 * code. `tone="risk"` is for money already at risk — an over-budget month, an
 * overdue invoice — and changes only the label and a hairline at the top
 * edge, because red means money at risk and nothing else (§3.2).
 */
export function GradientHero({
  children,
  style,
  tone = 'brand',
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'brand' | 'risk';
}) {
  const p = usePalette();
  return (
    <PanelTone.Provider value={tone}>
      <View
        style={[
          {
            backgroundColor: p.void,
            borderRadius: radius.xxl,
            borderWidth: 1,
            borderColor: tone === 'risk' ? 'rgba(240,137,127,0.35)' : p.voidRule,
            paddingHorizontal: 20,
            paddingVertical: 20,
            overflow: 'hidden',
          },
          style,
        ]}
      >
        {tone === 'risk' ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 20,
              right: 20,
              height: 2,
              backgroundColor: onVoid.risk,
            }}
          />
        ) : null}
        {children}
      </View>
    </PanelTone.Provider>
  );
}

/** The new name for the void panel. */
export const Instrument = GradientHero;

export function HeroLabel({ children }: { children: ReactNode }) {
  const p = usePalette();
  const tone = useContext(PanelTone);
  return (
    <Text style={[type.label, { color: tone === 'risk' ? onVoid.risk : p.voidMuted }]}>
      {children}
    </Text>
  );
}

export function HeroFigure({
  children,
  small,
  settle,
}: {
  children: ReactNode;
  small?: boolean;
  /** Animate the figure in, glyph by glyph, whenever it changes. Strings only. */
  settle?: boolean;
}) {
  const p = usePalette();
  const style = [
    small
      ? { ...type.display }
      : { ...type.hero },
    numeric,
    { color: p.voidInk },
  ];
  if (settle && typeof children === 'string') return <Settle value={children} style={style} />;
  return <Text style={style}>{children}</Text>;
}

export function HeroBody({ children }: { children: ReactNode }) {
  return <Text style={[type.body, { color: 'rgba(244,242,238,0.74)' }]}>{children}</Text>;
}

/* ── Card with an edge ───────────────────────────────────────────────────── */

export function Raised({
  children,
  style,
  accent,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Left edge stripe, used sparingly to mark status. */
  accent?: string;
}) {
  const p = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderRadius: radius.xl,
          padding: space.lg,
          borderWidth: 1,
          borderColor: p.rule,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {accent ? (
        <View
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, backgroundColor: accent }}
        />
      ) : null}
      {children}
    </View>
  );
}

/* ── Readout tile ────────────────────────────────────────────────────────── */

/**
 * One data point plus its label — a readout, not a bento card. It has no
 * fill: a hairline above it and the mono label are the whole frame, so two of
 * them side by side read as one instrument with two dials.
 */
export function Tile({
  label,
  value,
  hint,
  tone = 'default',
  wide,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'accent' | 'risk';
  wide?: boolean;
}) {
  const p = usePalette();
  const fg = tone === 'risk' ? p.risk : tone === 'accent' ? p.accentText : p.ink;
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: wide ? '100%' : '46%',
        paddingTop: space.md,
        gap: 4,
        borderTopWidth: 1,
        borderTopColor: tone === 'risk' ? p.risk : p.ruleStrong,
      }}
    >
      <Text style={[type.label, { color: tone === 'risk' ? p.risk : p.inkMuted }]}>{label}</Text>
      <Text style={[type.h1, { fontWeight: '300', letterSpacing: -0.8 }, numeric, { color: fg }]}>
        {value}
      </Text>
      {hint ? <Text style={[type.small, { color: p.inkMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/* ── Category breakdown bar ──────────────────────────────────────────────── */

/**
 * Where the money went, as one bar: a real total drawn in proportion, and
 * nothing a reader cannot check against the figures beside it.
 */
export function CategoryBar({
  parts,
}: {
  parts: Array<{ category: string; amount: number }>;
}) {
  const p = usePalette();
  const total = parts.reduce((a, x) => a + x.amount, 0) || 1;
  const top = [...parts].sort((a, b) => b.amount - a.amount).slice(0, 5);
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', height: 6, borderRadius: 1, overflow: 'hidden', gap: 2 }}>
        {top.map((s) => (
          <View
            key={s.category}
            style={{ flex: Math.max(s.amount / total, 0.02), backgroundColor: categoryHue(s.category) }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.sm }}>
        {top.slice(0, 4).map((s) => (
          <View key={s.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <CategorySwatch category={s.category} />
            <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={1}>
              {s.category.length > 18 ? `${s.category.slice(0, 17)}…` : s.category}
            </Text>
            <Text style={[type.mono, numeric, { color: p.ink }]}>
              {Math.round((s.amount / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export { radius };
