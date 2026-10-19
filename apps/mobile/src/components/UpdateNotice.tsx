import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { API_BASE_URL } from '@/api';
import { PressableScale } from '@/components/motion';
import { Body, Label, Small } from '@/components/ui';
import { radius, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

import {
  checkForUpdate,
  describe,
  dismiss,
  formatSize,
  type UpdateState,
} from '@/lib/updates';

/**
 * "There is a newer build" — shown once, dismissible, never in the way.
 *
 * WHAT IT DOES NOT DO. It does not install anything, and it does not block.
 * Android cannot silently install a sideloaded APK, and a person holding a
 * receipt over a table does not want a modal about software. So this is a notice
 * near the top of Home that can be waved away, and the download happens in the
 * browser when they choose.
 *
 * The honest cost is stated up front: the size, and that Android will ask
 * permission to install from the browser. Discovering that at the end of a
 * 50MB download on mobile data is the version of this that makes people stop
 * updating.
 */
export function UpdateNotice() {
  const p = usePalette();
  const [state, setState] = useState<UpdateState>({ status: 'none' });

  useEffect(() => {
    let cancelled = false;
    // Checked once per mount rather than on a timer. A build published while
    // somebody is mid-session is not urgent, and a poll is a battery cost for
    // information that keeps until the next time they open the app.
    void checkForUpdate(API_BASE_URL).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDismiss = useCallback(() => {
    if (state.status !== 'available') return;
    void dismiss(state.build.commit);
    setState({ status: 'none' });
  }, [state]);

  const onUpdate = useCallback(() => {
    if (state.status !== 'available') return;
    void Linking.openURL(state.downloadUrl);
  }, [state]);

  if (state.status !== 'available') return null;

  const size = formatSize(state.build.byteSize);

  return (
    <View
      style={{
        backgroundColor: p.surface,
        borderRadius: radius.lg,
        borderLeftWidth: 2,
        borderLeftColor: p.accent,
        paddingVertical: space.md,
        paddingHorizontal: 14,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Label style={{ color: p.accentText, flex: 1 }}>Update available</Label>
        <Text style={[type.mono, { color: p.inkMuted }]}>{describe(state.build)}</Text>
      </View>

      <Body>
        A newer build is ready{size ? ` (${size})` : ''}. Your receipts and anything waiting to
        send are kept — installing over the top does not sign you out.
      </Body>
      <Small>
        Downloads in your browser. Android will ask once for permission to install apps from
        there.
      </Small>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PressableScale
          accessibilityLabel="Download and install the update"
          onPress={onUpdate}
          haptic="light"
          scaleTo={0.98}
          containerStyle={{ flex: 1 }}
          style={{
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            backgroundColor: p.accent,
          }}
          pressedStyle={{ backgroundColor: p.accentDeep }}
        >
          <Text style={[type.bodyStrong, { color: p.accentInk }]}>Update</Text>
        </PressableScale>

        <PressableScale
          accessibilityLabel="Not now — hide this until the next build"
          onPress={onDismiss}
          scaleTo={0.98}
          style={{
            minHeight: 48,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: space.lg,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.ruleStrong,
          }}
          pressedStyle={{ backgroundColor: p.surfaceAlt }}
        >
          <Text style={[type.bodyStrong, { color: p.ink }]}>Not now</Text>
        </PressableScale>
      </View>
    </View>
  );
}
