import { useState } from 'react';
import { View } from 'react-native';
import { Icon } from '@/components/Icon';

import { PressableScale } from '@/components/motion';
import { IconButton, Label, Small } from '@/components/ui';
import { radius, space, type, usePalette } from '@/theme';
import { Text } from '@/theme/text';

import type { Transition } from '@/lib/provisional';

/**
 * The visible trace §7.1 requires when a value the person may already have
 * read turns out to be different.
 *
 * ONLY TWO TRANSITIONS PRODUCE A NOTICE, and that restraint is the design.
 * `confirmed` gets a quiet tick, `differs` and `suggestion` get a card,
 * `server-only` and `absent` get nothing at all — a chip on a field the
 * preview never touched would be noise that teaches people to stop reading
 * chips, which is exactly how the one that matters gets dismissed unread.
 *
 * `scan` cyan throughout, never `good` and never `risk`.
 * `docs/DESIGN-HANDOFF.md` reserves that hue for capture and extraction, and a
 * disagreement between two reads is not a compliance failure — it is the
 * machinery showing its work. Colouring it red would tell somebody their
 * receipt is wrong when what actually happened is that two readers disagreed
 * and the more authoritative one won.
 */
export function ProvisionalNotice({
  transition,
  onUseSuggestion,
}: {
  transition: Transition;
  /** Accepting a suggestion is a human correction — Stage 2 wires it to a PATCH. */
  onUseSuggestion?: (value: string) => void;
}) {
  const p = usePalette();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;
  if (transition.kind === 'absent' || transition.kind === 'server-only') return null;

  if (transition.kind === 'confirmed') {
    // A small "read twice" tick. Deliberately not a card: agreement is the
    // expected case and does not deserve the same weight as a disagreement.
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <Icon name="check" size={14} color={p.scan} />
        <Small>{transition.copy}</Small>
      </View>
    );
  }

  return (
    <View
      style={{
        marginTop: space.sm,
        paddingVertical: space.md,
        paddingLeft: 14,
        paddingRight: 4,
        borderRadius: radius.lg,
        // The 2px tone edge, as on `Notice`. A tint rather than a fill: this
        // sits inside a record somebody is reading, and it is advisory.
        borderLeftWidth: 2,
        borderLeftColor: p.scan,
        backgroundColor: p.surface,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Label style={{ color: p.inkStrong, flex: 1 }}>
          {transition.kind === 'differs' ? 'Two reads disagreed' : 'Not confirmed'}
        </Label>
        <IconButton
          name="close"
          label="Dismiss this notice"
          size={16}
          color={p.inkFaint}
          onPress={() => setDismissed(true)}
          style={{ marginVertical: -14 }}
        />
      </View>

      <Small style={{ paddingRight: 10 }}>{transition.copy}</Small>

      {transition.kind === 'suggestion' && onUseSuggestion ? (
        <PressableScale
          accessibilityLabel={`Use the preview value ${transition.suggested}`}
          onPress={() => onUseSuggestion(transition.suggested)}
          scaleTo={0.98}
          containerStyle={{ alignSelf: 'flex-start' }}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: space.lg,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.ruleStrong,
          }}
        >
          <Text style={[type.amount, { color: p.ink }]}>Use {transition.suggested}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * The "Provisional" chip, for a field the device read and the server has not
 * answered on yet.
 *
 * Dashed underline plus the chip, per §7.1. Two signals rather than one
 * because colour alone is not a signal to everybody, and this is the
 * distinction between "a number" and "a number nobody has checked".
 */
export function ProvisionalChip() {
  const p = usePalette();
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.xs,
        borderWidth: 1,
        borderColor: p.scan,
        borderStyle: 'dashed',
      }}
    >
      <Text style={[type.label, { color: p.inkStrong, fontSize: 10, lineHeight: 12, letterSpacing: 1 }]}>
        Provisional
      </Text>
    </View>
  );
}
