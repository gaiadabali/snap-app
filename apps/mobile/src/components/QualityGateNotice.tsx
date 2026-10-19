import { View } from 'react-native';

import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/motion';
import type { QualityGateWarning } from '@/lib/quality-gate';
import { onVoid, radius, space, type } from '@/theme';
import { Text } from '@/theme/text';

/**
 * OD-13's live quality gate, on screen.
 *
 * A DIFFERENT THING FROM `ProvisionalNotice`/`ProvisionalChip`, deliberately.
 * Those say "the phone read something, unconfirmed" in `scan` cyan — the
 * colour §7.1 reserves for a PROVISIONAL VALUE, never `good`, never `risk`.
 * This says "the phone could not read enough to be worth showing at all",
 * which is a different claim and gets a different colour: `warn` (amber),
 * the tone already used everywhere else in this app for "this needs a look
 * before it is right" — `Findings.tsx`'s `warning` severity, an unbalanced
 * total in `receipt.tsx`, the "Check" chips on `receipts.tsx`/`parties.tsx`.
 * Never `scan` (that would overload the provisional-value signal with an
 * unrelated one) and never `risk` (that colour is a compliance failure —
 * an unreadable photo is not the docket's fault).
 *
 * ADVISORY ONLY, exactly like the preview it rides beside. By the time this
 * can render, `uploadAndExtract` in `capture.tsx` has already started (or
 * finished) uploading the page it is warning about — nothing here cancels or
 * pauses that. "Retake" costs nothing because the person is still holding
 * the phone over the docket, and declining costs nothing either: the server
 * reads the page regardless, on its own schedule, whether or not anyone taps
 * anything here. `docs/ON-DEVICE.md` §9's rule — the capture is the product
 * and the preview may never cost one — applies to this notice exactly as it
 * applies to the preview it is not.
 *
 * It only ever appears over the camera, so it is drawn on the camera's dark
 * chrome — a dark panel with a 2px `warn` edge, `onVoid` hues, a mono label —
 * whichever theme is in force. Its two buttons are local for that reason: the
 * shared `Button` takes its ink from the palette, which is dark text on a
 * light theme and would vanish here.
 */
export function QualityGateNotice({
  warning,
  onRetake,
  onDismiss,
}: {
  warning: QualityGateWarning;
  /** Clears the tray so a fresh photo can be taken. Never touches the upload already in flight. */
  onRetake: () => void;
  onDismiss: () => void;
}) {
  return (
    <View
      style={{
        width: '100%',
        padding: space.md,
        borderRadius: radius.md,
        borderLeftWidth: 2,
        borderLeftColor: onVoid.warn,
        backgroundColor: 'rgba(12,12,14,0.86)',
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.label, { color: onVoid.warn, flex: 1 }]}>Might be hard to read</Text>
        <PressableScale
          accessibilityLabel="Dismiss this warning"
          onPress={onDismiss}
          scaleTo={0.9}
          hitSlop={4}
          style={{ width: 44, height: 44, marginVertical: -12, marginRight: -10, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={16} color="rgba(255,255,255,0.7)" />
        </PressableScale>
      </View>

      <Text style={[type.small, { color: 'rgba(255,255,255,0.8)' }]}>{warning.copy}</Text>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <PressableScale
          accessibilityLabel="Retake"
          onPress={onRetake}
          scaleTo={0.98}
          containerStyle={{ flex: 1 }}
          style={{
            minHeight: 48,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[type.bodyStrong, { color: '#FFFFFF' }]}>Retake</Text>
        </PressableScale>
        <PressableScale
          accessibilityLabel="Continue"
          onPress={onDismiss}
          scaleTo={0.98}
          containerStyle={{ flex: 1 }}
          style={{
            minHeight: 48,
            borderRadius: radius.md,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[type.bodyStrong, { color: '#000000' }]}>Continue</Text>
        </PressableScale>
      </View>
    </View>
  );
}
