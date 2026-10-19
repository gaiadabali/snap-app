import { Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, View } from 'react-native';
import { Text } from '@/theme/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Notice, Screen, ScreenHeader, Small } from '@/components/ui';
import { EXPERIMENTAL_FEATURES_ENABLED } from '@/config';
import { shadow, space, type, usePalette, useTheme } from '@/theme';

/**
 * Registering a fingerprint.
 *
 * ⚠ This is the ENROLMENT CEREMONY ONLY. Holding the pad fills a progress
 * ring and records a local preference; it does not talk to the platform
 * biometric API, because `expo-local-authentication` is not a dependency of
 * this app and adding one is a native-build decision rather than a screen's.
 *
 * What that means in practice: nothing here actually protects anything yet.
 * The screen is built because the prototype specifies it and the flow around
 * it — Privacy → Fingerprint → back — is real, but the switch it sets is
 * decorative until `expo-local-authentication` is wired in. That is stated
 * on the screen itself rather than only in this comment, so nobody demoing it
 * claims a security property the build does not have.
 */
const HOLD_MS = 1600;

export default function FingerprintScreen() {
  const p = usePalette();
  const { scheme } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      if (value >= 1) setDone(true);
    });
    return () => progress.removeListener(id);
  }, [progress]);

  // A route still navigable by URL is not hidden, only unadvertised. This
  // screen records a preference that locks nothing, so it must not be reachable
  // by accident once its privacy row is hidden.
  if (!EXPERIMENTAL_FEATURES_ENABLED) return <Redirect href="/privacy" />;

  function down() {
    setHolding(true);
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      // Height is not a transform, so this one cannot run on the UI thread.
      useNativeDriver: false,
    }).start();
  }

  function up() {
    setHolding(false);
    if (done) return;
    // Lifting early resets rather than pausing: a half-registered print is
    // not a state worth keeping, and a bar that resumes from 60% implies the
    // phone remembered something it did not.
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }

  const fill = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.md,
          paddingBottom: space.xxl,
          gap: space.xl,
        }}
      >
        <ScreenHeader title="Set up fingerprint" onBack={() => router.back()} />

        <Text style={[type.body, { color: p.inkMuted }]}>
          Hold your finger on the reader below. The phone registers the print; Snap Apps only
          stores whether it matched.
        </Text>

        <View style={{ alignItems: 'center', gap: space.lg, paddingTop: space.lg }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fingerprint reader. Press and hold."
            onPressIn={down}
            onPressOut={up}
            // A white pad like every other card; the ring colour is the state
            // (idle, holding, done). It clips for the rising fill, so on
            // Android the shadow may not render; the ring carries it anyway.
            style={[
              {
                width: 148,
                height: 172,
                borderRadius: 32,
                borderWidth: 2,
                borderColor: done ? p.good : holding ? p.accent : p.ruleStrong,
                backgroundColor: p.card,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              },
              scheme === 'light' ? shadow.card : null,
            ]}
          >
            {/* Unfilled print */}
            <Icon name="lock" size={84} color={p.ruleStrong} />
            {/* Filled print, revealed bottom-up as the hold completes */}
            <Animated.View
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: fill,
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <View style={{ width: 148, height: 172, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="lock" size={84} color={done ? p.good : p.accent} />
              </View>
            </Animated.View>
          </Pressable>

          <Text
            style={[
              type.bodyStrong,
              { color: done ? p.good : holding ? p.accentText : p.inkMuted, textAlign: 'center' },
            ]}
          >
            {done ? 'Fingerprint registered' : holding ? 'Hold still…' : 'Press and hold to register'}
          </Text>
        </View>

        <Notice tone="warn" icon="alert">
          Not active yet. This screen records the preference but does not yet lock the app —
          wiring it to the phone&rsquo;s real biometric reader needs a native build.
        </Notice>

        <Button
          label={done ? 'Done' : 'Skip for now'}
          tone={done ? 'accent' : 'outline'}
          onPress={() => router.back()}
        />
        <Small style={{ textAlign: 'center' }}>
          Your fingerprint never leaves the phone. Snap Apps receives a yes or a no, nothing else.
        </Small>
      </ScrollView>
    </Screen>
  );
}
