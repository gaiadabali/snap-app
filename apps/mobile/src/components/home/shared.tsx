import { useRouter, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CategoryIcon, Raised, radius } from '@/components/rich';
import { Body, Chip, Divider, Figure, Label, Small } from '@/components/ui';
import type { DocumentView } from '@/api';
import { formatAud, space, usePalette } from '@/theme';

/**
 * The pieces both home screens are built from.
 *
 * Business and personal ask different questions, so they are different
 * screens rather than one screen with branches. They share this vocabulary so
 * switching workspace changes the content, not the app.
 */

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Sum decimal strings exactly — never parse money to a float. */
export function sumMoney(values: string[]): string {
  const total = values.reduce((acc, v) => {
    const [w = '0', f = ''] = v.replace('-', '').split('.');
    return acc + BigInt(w) * 10_000n + BigInt((f + '0000').slice(0, 4));
  }, 0n);
  return `${total / 10_000n}.${(total % 10_000n).toString().padStart(4, '0')}`;
}

/** One of the round shortcuts under the hero. */
export function Action({ glyph, label, href }: { glyph: string; label: string; href: Href }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(href)}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 7, opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.lg,
          backgroundColor: p.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 22 }}>{glyph}</Text>
      </View>
      <Small muted={false} style={{ fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Small>
    </Pressable>
  );
}

/** A line in the attention card: what is wrong, what it is worth, where to fix it. */
export function AttentionRow({
  glyph,
  title,
  detail,
  value,
  tone,
  href,
  first,
}: {
  glyph: string;
  title: string;
  detail: string;
  value: string;
  tone: 'warn' | 'risk';
  href: Href;
  first?: boolean;
}) {
  const p = usePalette();
  const router = useRouter();
  const fg = tone === 'risk' ? p.risk : p.warn;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: p.rule,
        backgroundColor: pressed ? p.surfaceAlt : 'transparent',
      })}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: tone === 'risk' ? p.riskSoft : p.warnSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 17 }}>{glyph}</Text>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Body strong>{title}</Body>
        <Small numberOfLines={1}>{detail}</Small>
      </View>
      <Figure size="body" style={{ color: fg, fontWeight: '700' }}>
        {value}
      </Figure>
      <Small style={{ fontSize: 18 }}>›</Small>
    </Pressable>
  );
}

/** Half-width summary card. Tappable, unlike a plain stat tile. */
export function StatCard({
  label,
  value,
  hint,
  tone = 'ink',
  href,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'ink' | 'accent' | 'risk';
  href: Href;
}) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(href)}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.75 : 1 })}
    >
      <Raised style={{ gap: 5, padding: space.lg }}>
        <Label>{label}</Label>
        <Figure size="h1" tone={tone}>
          {value}
        </Figure>
        <Small numberOfLines={1}>{hint}</Small>
      </Raised>
    </Pressable>
  );
}

/** The last few receipts. Both workspaces end their home screen with this. */
export function LatestReceipts({ docs }: { docs: DocumentView[] }) {
  const p = usePalette();
  const router = useRouter();

  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>Latest</Label>
        <Pressable accessibilityRole="button" onPress={() => router.push('/receipts')} hitSlop={8}>
          <Small muted={false} style={{ color: p.accent, fontWeight: '600' }}>
            See all
          </Small>
        </Pressable>
      </View>

      <Raised style={{ padding: 0 }}>
        {docs.length === 0 ? (
          <View style={{ padding: space.xl, alignItems: 'center', gap: space.xs }}>
            <Body strong>Nothing scanned yet</Body>
            <Small>Tap Scan to capture your first receipt.</Small>
          </View>
        ) : (
          docs.map((d, i) => (
            <View key={d.id}>
              {i > 0 ? <Divider style={{ marginLeft: 68 }} /> : null}
              {/* The list settling in: a real change (this refresh's data),
                  cheap (opacity + a few px of translateY), and off entirely
                  under reduce-motion because Reanimated's entering animations
                  no-op when `AccessibilityInfo.isReduceMotionEnabled()` is on. */}
              <Animated.View entering={FadeInDown.duration(260).delay(Math.min(i, 6) * 35)}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/document/${d.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingHorizontal: space.lg,
                    paddingVertical: 12,
                    backgroundColor: pressed ? p.surfaceAlt : 'transparent',
                  })}
                >
                  <CategoryIcon category={d.category} size={38} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body strong numberOfLines={1}>
                      {d.supplierName}
                    </Body>
                    <Small numberOfLines={1}>{d.category}</Small>
                  </View>
                  {d.reviewStatus === 'needs_review' ? <Chip tone="warn">Check</Chip> : null}
                  <Figure size="h2">{formatAud(d.payableAmount)}</Figure>
                </Pressable>
              </Animated.View>
            </View>
          ))
        )}
      </Raised>
    </View>
  );
}
