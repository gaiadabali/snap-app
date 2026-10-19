import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { CategorySpend, SeriesPoint } from '@/api';
import { categoryHue } from '@/components/rich';
import { formatAud, numeric, space, type, usePalette } from '@/theme';

/**
 * Charts for the analytics page.
 *
 * Drawn rather than pulled from a charting library: the three shapes this app
 * needs are a bar series, a ring and a set of proportional bars, and a library
 * that draws all three would be larger than the app's own screens.
 *
 * Two rules hold throughout. Every label names a value the chart actually
 * reaches — no rounded-up axis maxima that make a bar look shorter than the
 * figure printed beside it. And every colour comes from the palette or from
 * `categoryHue`, so both themes stay legible and a category is the same colour
 * everywhere in the app.
 */

/* ── Bar series ────────────────────────────────────────────────────────── */

export function BarSeries({
  points,
  height = 168,
  onSelect,
}: {
  points: SeriesPoint[];
  height?: number;
  /** Called with the index tapped, or null when the selection is cleared. */
  onSelect?: (index: number | null) => void;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((pt) => Number(pt.value));
  const max = Math.max(...values, 1);
  const axis = 22; // room for the baseline labels
  const plot = height - axis;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const step = width / Math.max(points.length, 1);
  const barW = Math.max(6, Math.min(34, step * 0.56));

  const select = (i: number | null) => {
    setActive(i);
    onSelect?.(i);
  };

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {/* Two reference lines, at the maximum and at half of it. Drawn
              behind the bars and labelled on the chart itself, so the height
              of a bar can be read without a separate axis column. */}
          {[1, 0.5].map((f) => (
            <G key={f}>
              <Line
                x1={0}
                x2={width}
                y1={plot - plot * f * 0.88}
                y2={plot - plot * f * 0.88}
                stroke={p.rule}
                strokeWidth={1}
                strokeDasharray="3 4"
              />
              <SvgText
                x={0}
                y={plot - plot * f * 0.88 - 4}
                fill={p.inkFaint}
                fontSize={9}
                fontWeight="600"
              >
                {formatAud(String(max * f), { cents: false })}
              </SvgText>
            </G>
          ))}

          {points.map((pt, i) => {
            const v = Number(pt.value);
            const h = Math.max(2, (v / max) * plot * 0.88);
            const x = i * step + (step - barW) / 2;
            const on = active === i;
            return (
              <G key={`${pt.label}-${i}`}>
                <Rect
                  x={x}
                  y={plot - h}
                  width={barW}
                  height={h}
                  rx={Math.min(6, barW / 2)}
                  fill={p.accent}
                  // The bucket in progress is drawn faded inside a dashed
                  // outline: its height is real and worth reading, but it is
                  // not yet comparable to the completed bars beside it.
                  opacity={on ? 1 : pt.partial ? 0.34 : 0.82}
                  stroke={pt.partial ? p.accent : 'none'}
                  strokeWidth={pt.partial ? 1.5 : 0}
                  strokeDasharray={pt.partial ? '3 3' : undefined}
                />
                <SvgText
                  x={i * step + step / 2}
                  y={height - 6}
                  fill={on ? p.ink : p.inkFaint}
                  fontSize={9}
                  fontWeight={on ? '700' : '600'}
                  textAnchor="middle"
                >
                  {pt.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      ) : null}

      {/* Touch targets sit above the SVG: react-native-svg press handling is
          inconsistent across platforms, a plain Pressable row is not. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: plot, flexDirection: 'row' }}>
        {points.map((pt, i) => (
          <Pressable
            key={`hit-${pt.label}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`${pt.label}: ${formatAud(pt.value)}`}
            onPress={() => select(active === i ? null : i)}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}

/* ── Ring ──────────────────────────────────────────────────────────────── */

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const a = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(a(from));
  const y1 = cy + r * Math.sin(a(from));
  const x2 = cx + r * Math.cos(a(to));
  const y2 = cy + r * Math.sin(a(to));
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * Category split as a ring, with the total in the hole.
 *
 * A ring rather than a pie because the middle is the most valuable space on
 * the chart: it holds the figure everything else is a share of.
 */
export function CategoryRing({
  parts,
  size = 168,
  centreLabel,
  centreValue,
}: {
  parts: CategorySpend[];
  size?: number;
  centreLabel: string;
  centreValue: string;
}) {
  const p = usePalette();
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const total = parts.reduce((a, x) => a + Number(x.spent), 0);

  let cursor = 0;
  const top = parts.filter((x) => Number(x.spent) > 0).slice(0, 8);

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={r} stroke={p.surfaceAlt} strokeWidth={stroke} fill="none" />
        {total > 0
          ? top.map((s) => {
              const sweep = (Number(s.spent) / total) * 360;
              // A 2° gap keeps neighbouring segments distinguishable without
              // making the shares read short.
              const from = cursor;
              const to = cursor + Math.max(sweep - 2, 0.5);
              cursor += sweep;
              return (
                <Path
                  key={s.category}
                  d={arc(c, c, r, from, to)}
                  stroke={categoryHue(s.category)}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  fill="none"
                />
              );
            })
          : null}
      </Svg>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        <Text style={[type.label, { color: p.inkFaint }]}>{centreLabel}</Text>
        <Text style={[type.h2, numeric, { color: p.ink }]}>{centreValue}</Text>
      </View>
    </View>
  );
}

/* ── Category bars with optional budget ────────────────────────────────── */

/**
 * One row per category: name, amount, and a bar.
 *
 * When a budget exists the bar is measured against the BUDGET and turns red
 * past 100% — the question in the personal workspace is "am I over?", not
 * "which category is biggest?". Without a budget it falls back to a share of
 * the largest category, which is the only honest scale available.
 */
export function CategoryBars({
  parts,
  limit = 6,
}: {
  parts: CategorySpend[];
  limit?: number;
}) {
  const p = usePalette();
  const shown = parts.slice(0, limit);
  const biggest = Math.max(...shown.map((s) => Number(s.spent)), 1);

  return (
    <View style={{ gap: space.md }}>
      {shown.map((s) => {
        const over = s.used !== null && s.used > 1;
        const fill = s.used !== null ? Math.min(s.used, 1) : Number(s.spent) / biggest;
        const hue = over ? p.risk : categoryHue(s.category);
        return (
          <View key={s.category} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
              <Text style={[type.body, { color: p.ink, flex: 1 }]} numberOfLines={1}>
                {s.category}
              </Text>
              <Text style={[type.bodyStrong, numeric, { color: over ? p.risk : p.ink }]}>
                {formatAud(s.spent)}
              </Text>
              {s.budget ? (
                <Text style={[type.small, numeric, { color: p.inkFaint }]}>
                  / {formatAud(s.budget, { cents: false })}
                </Text>
              ) : null}
            </View>
            <View
              style={{
                height: 8,
                borderRadius: 4,
                backgroundColor: p.surfaceAlt,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.max(2, fill * 100)}%`,
                  height: '100%',
                  borderRadius: 4,
                  backgroundColor: hue,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ── Legend ────────────────────────────────────────────────────────────── */

export function RingLegend({ parts, limit = 6 }: { parts: CategorySpend[]; limit?: number }) {
  const p = usePalette();
  const total = parts.reduce((a, x) => a + Number(x.spent), 0) || 1;
  return (
    <View style={{ flex: 1, gap: 8 }}>
      {parts.slice(0, limit).map((s) => (
        <View key={s.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              backgroundColor: categoryHue(s.category),
            }}
          />
          <Text style={[type.small, { color: p.inkMuted, flex: 1 }]} numberOfLines={1}>
            {s.category}
          </Text>
          <Text style={[type.small, numeric, { color: p.ink, fontWeight: '700' }]}>
            {Math.round((Number(s.spent) / total) * 100)}%
          </Text>
        </View>
      ))}
    </View>
  );
}
