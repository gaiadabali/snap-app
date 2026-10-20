import * as Linking from 'expo-linking';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { API_BASE_URL } from '@/api';
import { Body, Figure, Screen, Small } from '@/components/ui';
import { checkMinimum, describe, formatSize, releaseNotes, type MinimumState } from '@/lib/updates';
import { radius, space, usePalette } from '@/theme';

/**
 * Blocks the whole app when this build is below the server's minimum supported
 * build (`ANDROID_MIN_VERSION_CODE`), and otherwise renders its children
 * untouched.
 *
 * It exists for the day a server change makes old builds unsafe or useless: an
 * ordinary update card can be dismissed, and a build that is no longer
 * supported must not be. There is deliberately no way past this screen except
 * installing the update.
 *
 * CHECKED AT LAUNCH AND ON RETURN TO THE FOREGROUND, because the person may
 * leave the app for a day and the server's minimum may have moved meanwhile.
 * Every uncertain case lets the app through (see `lib/updates.ts`): offline,
 * no manifest, no minimum, or a build that does not know its own versionCode.
 * Once blocked it stays blocked for the life of the process, so going offline
 * cannot be used to dodge the gate.
 *
 * It sits OUTSIDE the session gate on purpose: a signed-out person on an
 * unsupported build should be told to update, not shown a sign-in that may no
 * longer work.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MinimumState>({ status: 'ok' });

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void checkMinimum(API_BASE_URL).then((next) => {
        if (cancelled) return;
        // Once blocked, stay blocked: the only way out is installing the
        // update, which restarts the app. A later check that answers `ok`
        // may just mean the phone is offline, and airplane mode must not
        // lift the gate.
        setState((prev) => (prev.status === 'required' ? prev : next));
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  if (state.status !== 'required') return <>{children}</>;
  return <UpdateRequired state={state} />;
}

function UpdateRequired({ state }: { state: Extract<MinimumState, { status: 'required' }> }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const size = formatSize(state.build.byteSize);
  const notes = releaseNotes(state.build);

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: space.gutter,
          paddingTop: insets.top + space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.sm }}>
          <Figure size="h1">Update required</Figure>
          <Small>{describe(state.build)}</Small>
        </View>

        <View style={{ gap: space.sm }}>
          <Body>
            This version of Snap Apps is too old to keep working with the server. Install the
            latest build{size ? ` (${size})` : ''} to carry on.
          </Body>
          <Body>
            Your receipts and anything waiting to send are kept — installing over the top does not
            sign you out.
          </Body>
          {notes ? (
            <View style={{ gap: space.xs }}>
              <Body strong>What&apos;s new</Body>
              <Body>{notes}</Body>
            </View>
          ) : null}
          <Small>
            Downloads in your browser. Android will ask once for permission to install apps from
            there.
          </Small>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download and install the required update"
          onPress={() => void Linking.openURL(state.downloadUrl)}
          style={({ pressed }) => ({
            alignItems: 'center',
            paddingVertical: space.md,
            borderRadius: radius.md,
            backgroundColor: p.accent,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Body strong style={{ color: '#FFFFFF' }}>
            Download update
          </Body>
        </Pressable>
      </View>
    </Screen>
  );
}
