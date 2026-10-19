import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  useColorScheme,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from '@/theme/text';

import { Icon, type IconName } from '@/components/Icon';
import { heroGradient, hueFor, numeric, radius, shadow, space, type, usePalette, useTheme } from '@/theme';

/**
 * The richer surface of the design system.
 *
 * Added after the first build read as "a flat spreadsheet". The patterns here
 * are the ones this category has converged on: a vibrant gradient card carrying
 * the headline figure, per-category colour so a list is scannable without
 * reading, cards that float rather than sit flat, and asymmetric bento tiles
 * for stats. Colour is doing work — it encodes category and status — rather
 * than decorating.
 */

/* ── Category colour ───────────────────────────────────────────────────────
   One hue per category so the eye can sort the list before reading a word.
   Chosen for even perceived brightness so no single row shouts louder than
   the rest, and legible on both grounds. */
/**
 * Business categories, which the prototype does not cover — it is a personal
 * -finance board. The personal hues now come from `hueFor` in the theme so the
 * two clients agree; only these business rows are held locally, on the same
 * palette range so the two workspaces never look like the same data reordered.
 */
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
 * Tinted disc carrying the category icon.
 *
 * The glyphs used to be emoji. They rendered at a different weight on every
 * platform — and on Android several of them arrived as a blank box — so they
 * are stroke icons now, tinted with the category's own ink rather than drawn
 * in whatever colours the vendor font ships.
 */
export function CategoryIcon({ category, size = 44 }: { category: string; size?: number }) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const business = CATEGORY[category];
  const personal = hueFor(category, scheme);
  const hue = business?.hue ?? personal.hue;
  const ink = business?.ink ?? personal.ink;
  const icon = business?.icon ?? PERSONAL_ICON[category] ?? 'tag';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        // A tint of the category hue: enough colour to sort by, never enough
        // to compete with the amount on the right.
        backgroundColor: `${hue}38`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.48)} color={ink} />
    </View>
  );
}

/* ── Gradient hero ───────────────────────────────────────────────────────── */

/**
 * The headline card. Carries the one figure that answers "am I okay?", in the
 * largest type on the screen, on the brand gradient from the launch teaser.
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
  const { scheme } = useTheme();
  /* The brand stops, from the 2026-09-19 prototype. Deeper and flatter than
     the first build's sky-blue ramp: the redesign runs the gradient *within*
     the dark half of the brand blue, which is what lets 40pt white figures sit
     on it without the top-left corner washing them out. */
  const colors: [string, string, string] =
    tone === 'risk'
      ? ['#E0574B', '#C4322A', '#9E2419']
      : [...heroGradient.colors];
  /* Two changes in the premium pass (2026-10-19), and why:
       - The two translucent circles floating in the card are gone. They are
         the stock "fintech card" ornament, and nothing on a balance should be
         decoration. In their place, one diagonal sheen across the top — the
         way light falls on a real card — and a 1px lit top edge.
       - The card is LIFTED: a soft shadow in its own blue, so the headline
         figure sits above the page instead of being painted on it. The
         shadow needs an unclipped wrapper; the gradient itself still clips
         its corners. */
  /* `style` was always the CARD's style — screens use it for the card's own
     layout (`flexDirection: 'row'` on Purchases, `gap` on a goal) as well as
     for where it sits. Now that a wrapper carries the shadow, the two are
     split: placement goes to the wrapper, everything else to the card, so a
     row-laid card does not collapse to its content's width. */
  const { outer, inner } = splitPlacement(style);
  return (
    <View
      style={[
        { borderRadius: (inner.borderRadius as number | undefined) ?? radius.xxl },
        scheme === 'light'
          ? { ...shadow.lift, shadowColor: tone === 'risk' ? '#9E2419' : shadow.lift.shadowColor }
          : null,
        outer,
      ]}
    >
      <LinearGradient
        colors={colors}
        locations={tone === 'risk' ? undefined : [...heroGradient.locations]}
        start={heroGradient.start}
        end={heroGradient.end}
        style={[
          {
            borderRadius: radius.xxl,
            padding: 22,
            overflow: 'hidden',
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: 'rgba(255,255,255,0.14)',
          },
          inner,
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.75, y: 0.6 }}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </LinearGradient>
    </View>
  );
}

export function HeroLabel({ children }: { children: ReactNode }) {
  return (
    <Text style={[type.label, { color: 'rgba(255,255,255,0.82)' }]}>{children}</Text>
  );
}

export function HeroFigure({ children, small }: { children: ReactNode; small?: boolean }) {
  return (
    <Text
      style={[
        small ? type.h1 : { fontSize: 40, lineHeight: 46, fontWeight: '700' },
        numeric,
        { color: '#FFFFFF' },
      ]}
    >
      {children}
    </Text>
  );
}

export function HeroBody({ children }: { children: ReactNode }) {
  return <Text style={[type.body, { color: 'rgba(255,255,255,0.9)' }]}>{children}</Text>;
}

/* ── Elevated card ───────────────────────────────────────────────────────── */

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
  const { scheme } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: p.card,
          borderRadius: 18,
          padding: space.lg,
        },
        // White on the light ground with a two-layer shadow; on the dark
        // ground a shadow cannot be seen, so a lifted fill and a hairline.
        scheme === 'light'
          ? shadow.card
          : { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: p.cardEdge },
        style,
      ]}
    >
      {accent ? (
        <View
          // Rounded with the card: the card no longer clips (a clipped view
          // cannot cast its shadow), so the stripe follows the corner itself.
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: accent,
            borderTopLeftRadius: 18,
            borderBottomLeftRadius: 18,
          }}
        />
      ) : null}
      {children}
    </View>
  );
}

/* ── Bento tile ──────────────────────────────────────────────────────────── */

/**
 * One data point plus its label. Two hero tiles per section is the practical
 * limit — a third gives the eye no anchor.
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
  const fg = tone === 'risk' ? p.risk : tone === 'accent' ? p.accent : p.ink;
  const bg = tone === 'risk' ? p.riskSoft : tone === 'accent' ? p.accentSoft : p.card;
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: wide ? '100%' : '46%',
        backgroundColor: bg,
        borderRadius: 16,
        padding: space.lg,
        gap: 6,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tone === 'default' ? p.rule : 'transparent',
      }}
    >
      <Text style={[type.label, { color: tone === 'default' ? p.inkFaint : fg }]}>{label}</Text>
      <Text style={[type.h1, numeric, { color: fg }]}>{value}</Text>
      {hint ? <Text style={[type.small, { color: p.inkMuted }]}>{hint}</Text> : null}
    </View>
  );
}

/* ── Category breakdown bar ──────────────────────────────────────────────── */

/**
 * Where the money went, as one bar. A donut would need a drawing library and
 * says no more than this does at a glance.
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
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }}>
        {top.map((s) => (
          <View
            key={s.category}
            style={{ flex: Math.max(s.amount / total, 0.02), backgroundColor: categoryHue(s.category) }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {top.slice(0, 4).map((s) => (
          <View key={s.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: categoryHue(s.category) }}
            />
            <Text style={[type.small, { color: p.inkMuted }]} numberOfLines={1}>
              {s.category.length > 18 ? `${s.category.slice(0, 17)}…` : s.category}
            </Text>
            <Text style={[type.small, numeric, { color: p.ink, fontWeight: '600' }]}>
              {Math.round((s.amount / total) * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export { radius };

/** Style keys that place a box in its parent, rather than lay out its own
 *  content. They belong on the hero's shadow wrapper; the rest on the card. */
const PLACEMENT = new Set([
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'alignSelf',
  'width',
  'minWidth',
  'maxWidth',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'zIndex',
]);

function splitPlacement(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (PLACEMENT.has(k) ? outer : inner)[k] = v;
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}
