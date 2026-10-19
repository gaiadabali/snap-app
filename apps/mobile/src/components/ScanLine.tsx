import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { usePalette } from '@/theme';

/**
 * The signature sweep — reserved for capture/extraction, per
 * `docs/DESIGN-HANDOFF.md` §10: "it stops being a signature if it decorates a
 * balance." This is the only place in the app that renders it.
 *
 * Runs entirely on the UI thread via Reanimated (`withRepeat`/`withTiming`),
 * so the JS thread doing the real upload/extraction work never makes it
 * stutter, and it never mounts at all outside the moment it means something:
 * nothing is rendered while `active` is false.
 *
 * Respects `prefers-reduced-motion`: with reduce motion on, this renders
 * nothing rather than a static line standing in for it — the phase label and
 * spinner already say "reading the receipt" without it.
 */
export function ScanLine({ active, style }: { active: boolean; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const progress = useSharedValue(0);
  const [height, setHeight] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v: boolean) => {
      setReduceMotion(v);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const shouldAnimate = active && !reduceMotion && height > 0;

  useEffect(() => {
    if (shouldAnimate) {
      progress.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAnimate]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value * Math.max(height - 2, 0) }],
  }));

  if (!active) return null;

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      {!reduceMotion ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: p.scan,
              shadowColor: p.scan,
              shadowOpacity: 0.9,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 0 },
            },
            lineStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
