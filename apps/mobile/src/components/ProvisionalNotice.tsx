import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/Icon';

import { Body, Card, Small } from '@/components/ui';
import { radius, space, usePalette } from '@/theme';

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs }}>
        <Icon name="check" size={14} color={p.scan} />
        <Small>{transition.copy}</Small>
      </View>
    );
  }

  return (
    // A white lifted card, per the premium pass; the `scan` hairline and title
    // keep the provisional-value colour. Advisory, so no tinted fill.
    <Card bordered style={{ marginTop: space.sm, borderColor: p.scan }}>
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
          <Body strong style={{ color: p.scan, flex: 1 }}>
            {transition.kind === 'differs' ? 'Two reads disagreed' : 'Not confirmed'}
          </Body>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss this notice"
            hitSlop={12}
            onPress={() => setDismissed(true)}
          >
            <Body style={{ color: p.inkFaint }}>×</Body>
          </Pressable>
        </View>

        <Small>{transition.copy}</Small>

        {transition.kind === 'suggestion' && onUseSuggestion ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use the preview value ${transition.suggested}`}
            onPress={() => onUseSuggestion(transition.suggested)}
            style={({ pressed }) => ({
              alignSelf: 'flex-start',
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: p.scan,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Body style={{ color: p.scan }}>Use {transition.suggested}</Body>
          </Pressable>
        ) : null}
      </View>
    </Card>
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
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: p.scan,
        borderStyle: 'dashed',
      }}
    >
      <Small style={{ color: p.scan, fontSize: 11 }}>Provisional</Small>
    </View>
  );
}
