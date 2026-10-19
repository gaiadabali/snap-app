import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '@/theme';
import { Text } from '@/theme/text';

/**
 * The motion vocabulary. Small on purpose: three things, each of which reports
 * something the system did rather than decorating the screen.
 *
 *   - `PressableScale` — the control acknowledging the finger. A 3% give and a
 *     selection tick, so a tap is felt before the next screen arrives.
 *   - `Settle` — a figure arriving from the API, glyph by glyph. Web's Settle
 *     motif (DESIGN-HANDOFF.md §13), at phone scale. It animates the STRING;
 *     no digit is ever parsed or counted up, because money here is a decimal
 *     string and a count-up would be client-side arithmetic on it.
 *   - `useFill` — a meter drawing to a measured value.
 *
 * Every timing passes `ReduceMotion.System`, so with the OS setting on, the
 * finished state is simply there.
 */

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** A tick under the finger. A no-op on web, where there is nothing to tick. */
export function tick(kind: 'select' | 'light' | 'success' | 'warn' = 'select') {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'select'
      ? Haptics.selectionAsync()
      : kind === 'light'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : Haptics.notificationAsync(
            kind === 'success'
              ? Haptics.NotificationFeedbackType.Success
              : Haptics.NotificationFeedbackType.Warning,
          );
  void run.catch(() => {
    /* No haptic engine is not an error. */
  });
}

/**
 * A pressable that gives slightly under the finger.
 *
 * Two styles because a Pressable that animates its own transform cannot also
 * take a function style reliably on every platform: `containerStyle` is the
 * layout slot (flex, width, margin), `style` is the visual box that scales.
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  pressedStyle,
  containerStyle,
  scaleTo = 0.97,
  haptic = 'select',
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  hitSlop,
  testID,
}: {
  children: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Merged over `style` while the finger is down. */
  pressedStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: 'select' | 'light' | 'none';
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  hitSlop?: number;
  testID?: string;
}) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => {
        s.value = withTiming(scaleTo, { duration: 90, easing: ease, reduceMotion: ReduceMotion.System });
      }}
      onPressOut={() => {
        s.value = withTiming(1, { duration: 180, easing: ease, reduceMotion: ReduceMotion.System });
      }}
      onPress={(e) => {
        if (haptic !== 'none') tick(haptic);
        onPress?.(e);
      }}
      onLongPress={onLongPress}
      style={containerStyle}
    >
      {({ pressed }) => (
        <Animated.View style={[style, pressed ? pressedStyle : null, a]}>{children}</Animated.View>
      )}
    </Pressable>
  );
}

/* ── Settle ───────────────────────────────────────────────────────────────── */

function Glyph({
  char,
  index,
  progress,
  style,
}: {
  char: string;
  index: number;
  progress: SharedValue<number>;
  style: StyleProp<TextStyle>;
}) {
  const a = useAnimatedStyle(() => {
    // Each glyph owns a window of the shared run, offset by its index.
    const start = index * 0.06;
    const t = Math.min(1, Math.max(0, (progress.value - start) / 0.5));
    return { opacity: t, transform: [{ translateY: (1 - t) * 10 }] };
  });
  return (
    <Animated.View style={a}>
      <Text style={style}>{char}</Text>
    </Animated.View>
  );
}

/**
 * A figure that settles into place when its value changes.
 *
 * The container carries the whole string as its accessibility label and the
 * glyphs are hidden from the screen reader, so "$1,605.18" is read once, as
 * money, not as nine characters.
 */
export function Settle({
  value,
  style,
  accessibilityLabel,
}: {
  value: string;
  style: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  const progress = useSharedValue(0);
  const glyphs = [...value];

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      40,
      withTiming(1 + glyphs.length * 0.06, {
        duration: motion.settle + glyphs.length * motion.stagger,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
    // Re-run only when the string itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? value}
      style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'nowrap' }}
    >
      <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row' }}>
        {glyphs.map((c, i) => (
          <Glyph key={`${i}-${c}`} char={c} index={i} progress={progress} style={style} />
        ))}
      </View>
    </View>
  );
}

/* ── Fill ─────────────────────────────────────────────────────────────────── */

/**
 * A 0–1 value that draws in from zero on mount and eases to each new value.
 * Returns an animated style setting `width` as a percentage.
 */
export function useFill(value: number, delay = 120) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(
      delay,
      withTiming(Math.max(0, Math.min(1, value)), {
        duration: motion.settle,
        easing: ease,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [value, delay, w]);
  return useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
}
