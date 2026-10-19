import { useRouter, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import type { DocumentView } from '@/api';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import { CategorySwatch, Raised } from '@/components/rich';
import { Chip, Figure, LedgerRow, Section, Small } from '@/components/ui';
import { formatAud, formatShortDate, radius, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

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

/**
 * A row of shortcuts drawn as one strip of keys.
 *
 * Was four pastel rounded squares floating over captions — the most generic
 * shape a finance app can put under its hero. A single outlined strip divided
 * by hairlines reads as one control with four keys, which is what it is, and
 * takes half the height.
 */
export function Keypad({ keys }: { keys: Array<{ icon: IconName; label: string; href: Href }> }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: p.rule,
        borderRadius: radius.xl,
        overflow: 'hidden',
      }}
    >
      {keys.map((k, i) => (
        <PressableScale
          key={k.label}
          accessibilityLabel={k.label}
          onPress={() => router.push(k.href)}
          scaleTo={0.96}
          containerStyle={{
            flex: 1,
            borderLeftWidth: i === 0 ? 0 : 1,
            borderLeftColor: p.rule,
          }}
          style={{ paddingVertical: 14, paddingHorizontal: space.md, gap: 10, minHeight: 72 }}
          pressedStyle={{ backgroundColor: p.surface }}
        >
          <Icon name={k.icon} size={20} color={p.inkStrong} />
          <Text style={[type.smallStrong, { color: p.ink }]} numberOfLines={1}>
            {k.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

/**
 * One shortcut on its own, for a screen that lays them out itself. Same key
 * as `Keypad` draws, with its own edge.
 */
export function Action({ icon, label, href }: { icon: IconName; label: string; href: Href }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <PressableScale
      accessibilityLabel={label}
      onPress={() => router.push(href)}
      scaleTo={0.96}
      containerStyle={{ flex: 1 }}
      style={{
        paddingVertical: 14,
        paddingHorizontal: space.md,
        gap: 10,
        minHeight: 72,
        borderWidth: 1,
        borderColor: p.rule,
        borderRadius: radius.xl,
      }}
      pressedStyle={{ backgroundColor: p.surface }}
    >
      <Icon name={icon} size={20} color={p.inkStrong} />
      <Text style={[type.smallStrong, { color: p.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** A line in the attention card: what is wrong, what it is worth, where to fix it. */
export function AttentionRow({
  icon,
  title,
  detail,
  value,
  tone,
  href,
  first,
}: {
  icon: IconName;
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
      <View style={{ width: 2, alignSelf: 'stretch', backgroundColor: fg, borderRadius: 1 }} />
      <Icon name={icon} size={18} color={fg} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[type.bodyStrong, { color: p.ink }]}>{title}</Text>
        <Small numberOfLines={1}>{detail}</Small>
      </View>
      <Figure size="body" style={{ color: fg }}>
        {value}
      </Figure>
      <Icon name="chevronRight" size={16} color={p.inkFaint} />
    </Pressable>
  );
}

/** Half-width summary readout. Tappable, unlike a plain stat tile. */
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
  const p = usePalette();
  return (
    <PressableScale
      onPress={() => router.push(href)}
      containerStyle={{ flex: 1 }}
      style={{ gap: 4 }}
    >
      <Raised style={{ gap: 4, padding: space.lg }}>
        <Text style={[type.label, { color: p.inkMuted }]}>{label}</Text>
        <Figure size="h1" tone={tone}>
          {value}
        </Figure>
        <Small numberOfLines={1}>{hint}</Small>
      </Raised>
    </PressableScale>
  );
}

/**
 * The last few receipts, as a ledger. Both workspaces end their home screen
 * with this.
 *
 * The date sits in a mono gutter on the left, the way a ledger or a bank
 * statement prints it, so the list can be read down the left edge for "when"
 * and down the right edge for "how much" without reading the middle at all.
 */
export function LatestReceipts({ docs }: { docs: DocumentView[] }) {
  const p = usePalette();
  const router = useRouter();

  return (
    <Section
      label="Latest"
      action={{ label: 'See all', onPress: () => router.push('/receipts') }}
      style={{ paddingHorizontal: space.lg }}
    >
      {docs.length === 0 ? (
        <View style={{ paddingVertical: space.xl, gap: space.xs }}>
          <Text style={[type.bodyStrong, { color: p.ink }]}>Nothing scanned yet</Text>
          <Small>Tap Scan to capture your first receipt.</Small>
        </View>
      ) : (
        docs.map((d, i) => (
          /* The list settling in: a real change (this refresh's data), cheap
             (opacity only), and off under reduce-motion because Reanimated's
             entering animations no-op when the OS setting is on. */
          <Animated.View key={d.id} entering={FadeIn.duration(260).delay(Math.min(i, 6) * 40)}>
            <LedgerRow
              first={i === 0}
              gutter={formatShortDate(d.issueDate).toUpperCase()}
              title={d.supplierName}
              note={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <CategorySwatch category={d.category} size={7} />
                  <Small numberOfLines={1} style={{ flexShrink: 1 }}>
                    {d.category}
                  </Small>
                  {d.reviewStatus === 'needs_review' ? <Chip tone="warn">Check</Chip> : null}
                </View>
              }
              figure={formatAud(d.payableAmount)}
              onPress={() => router.push(`/document/${d.id}`)}
              accessibilityLabel={`${d.supplierName}, ${formatAud(d.payableAmount)}, ${formatShortDate(d.issueDate)}`}
            />
          </Animated.View>
        ))
      )}
    </Section>
  );
}
