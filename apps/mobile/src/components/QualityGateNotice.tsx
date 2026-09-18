import { Pressable, View } from 'react-native';

import { Body, Button, Label, Small } from '@/components/ui';
import type { QualityGateWarning } from '@/lib/quality-gate';
import { radius, space, usePalette } from '@/theme';

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
  const p = usePalette();
  return (
    <View
      style={{
        width: '100%',
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: p.warn,
        backgroundColor: p.warnSoft,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <Label style={{ color: p.warn, flex: 1 }}>Might be hard to read</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss this warning"
          hitSlop={12}
          onPress={onDismiss}
        >
          <Body style={{ color: p.inkMuted }}>×</Body>
        </Pressable>
      </View>

      <Small>{warning.copy}</Small>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Retake" tone="outline" style={{ flex: 1 }} onPress={onRetake} />
        <Button label="Continue" style={{ flex: 1 }} onPress={onDismiss} />
      </View>
    </View>
  );
}
