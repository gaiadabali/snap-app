import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { DocumentLine } from '@/api';
import { AddButton, Choice, Field, Sheet } from '@/components/form';
import { Raised } from '@/components/rich';
import { Body, ConfidenceDots, Divider, Figure, Label, Small } from '@/components/ui';
import { formatAud, space, usePalette } from '@/theme';

/**
 * The lines off the receipt, correctable by hand.
 *
 * Extraction produces a proposal; a person confirms it. That is the whole
 * review model, and it applies to the lines as much as to the total — a model
 * that reads "MILK 2L" as "MILK 2.0" has produced a plausible document that
 * is wrong, and only a human looking at the photo beside it can say so.
 *
 * Edits are held locally and saved as a set, because the lines only mean
 * anything measured against the total. Saving them one at a time would let
 * the document sit in states where it does not add up.
 */

type Draft = {
  description: string;
  quantity: string;
  amount: string;
  gstFree: boolean;
};

const blank: Draft = { description: '', quantity: '1', amount: '', gstFree: false };

function toDraft(line: DocumentLine): Draft {
  return {
    description: line.description,
    quantity: String(line.quantity),
    amount: Number(line.amount).toFixed(2),
    gstFree: line.gstFree,
  };
}

export function LineItems({
  lines,
  category,
  editable,
  onChange,
}: {
  lines: DocumentLine[];
  category: string;
  editable: boolean;
  /** Called with the complete new set of lines. */
  onChange: (lines: DocumentLine[]) => void | Promise<void>;
}) {
  const p = usePalette();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState<string | null>(null);

  const valid =
    draft.description.trim().length > 0 &&
    Number(draft.amount) > 0 &&
    Number(draft.quantity) > 0;

  function build(d: Draft, lineNumber: number, confidence: number): DocumentLine {
    const qty = Number(d.quantity);
    const amount = Number(d.amount).toFixed(4);
    return {
      lineNumber,
      description: d.description.trim(),
      quantity: qty,
      unitPrice: (Number(amount) / qty).toFixed(4),
      amount,
      gstFree: d.gstFree,
      category,
      // A hand-entered line is certain by definition — a person read it off
      // the paper. Leaving it at the model's confidence would understate it.
      confidence,
    };
  }

  async function commit(next: DocumentLine[]) {
    setError(null);
    try {
      await onChange(next);
      setEditingIndex(null);
      setAdding(false);
      setDraft(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save those lines.');
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>What was on it</Label>
        <Small>
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </Small>
      </View>

      <Raised style={{ padding: 0 }}>
        {lines.length === 0 ? (
          <View style={{ padding: space.lg, gap: 4 }}>
            <Body strong>No lines read</Body>
            <Small>Add them by hand if the receipt itemises the purchase.</Small>
          </View>
        ) : (
          lines.map((l, i) => (
            <View key={`${l.lineNumber}-${l.description}`}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessibilityRole={editable ? 'button' : 'text'}
                accessibilityLabel={`${l.description}, ${formatAud(l.amount)}`}
                onPress={
                  editable
                    ? () => {
                        setDraft(toDraft(l));
                        setEditingIndex(i);
                      }
                    : undefined
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: 12,
                  backgroundColor: pressed && editable ? p.surfaceAlt : 'transparent',
                })}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Body strong numberOfLines={1}>
                    {l.description}
                  </Body>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Small>
                      {l.quantity > 1 ? `${l.quantity} × ${formatAud(l.unitPrice)}` : 'Qty 1'}
                    </Small>
                    {l.gstFree ? (
                      <Small muted={false} style={{ color: p.accent, fontWeight: '600' }}>
                        GST-free
                      </Small>
                    ) : null}
                    <ConfidenceDots value={l.confidence} />
                  </View>
                </View>
                <Figure size="h2">{formatAud(l.amount)}</Figure>
                {editable ? <Small style={{ fontSize: 16 }}>›</Small> : null}
              </Pressable>
            </View>
          ))
        )}
      </Raised>

      {editable ? (
        <AddButton
          label="Add a line"
          onPress={() => {
            setDraft(blank);
            setAdding(true);
          }}
        />
      ) : null}

      {/* Edit */}
      <Sheet
        open={editingIndex !== null}
        title="Edit line"
        subtitle="Check it against the image above."
        error={error}
        submitLabel="Save line"
        submitDisabled={!valid}
        onClose={() => {
          setEditingIndex(null);
          setError(null);
        }}
        onSubmit={async () => {
          if (editingIndex === null) return;
          const existing = lines[editingIndex]!;
          const next = lines.map((l, i) =>
            i === editingIndex ? build(draft, l.lineNumber, 1) : l,
          );
          await commit(next);
          void existing;
        }}
      >
        <LineFields draft={draft} setDraft={setDraft} />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (editingIndex === null) return;
            void commit(lines.filter((_, i) => i !== editingIndex));
          }}
          style={{ paddingVertical: space.sm }}
        >
          <Text style={{ color: p.risk, fontWeight: '700', textAlign: 'center' }}>
            Remove this line
          </Text>
        </Pressable>
      </Sheet>

      {/* Add */}
      <Sheet
        open={adding}
        title="Add a line"
        subtitle="For something the extraction missed."
        error={error}
        submitLabel="Add line"
        submitDisabled={!valid}
        onClose={() => {
          setAdding(false);
          setError(null);
        }}
        onSubmit={() => commit([...lines, build(draft, lines.length + 1, 1)])}
      >
        <LineFields draft={draft} setDraft={setDraft} />
      </Sheet>
    </View>
  );
}

function LineFields({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
}) {
  return (
    <>
      <Field
        label="Description"
        value={draft.description}
        onChangeText={(description) => setDraft({ ...draft, description })}
        placeholder="Diesel"
        autoFocus
      />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Quantity"
            value={draft.quantity}
            onChangeText={(quantity) => setDraft({ ...draft, quantity })}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={{ flex: 2 }}>
          <Field
            label="Line total"
            value={draft.amount}
            onChangeText={(amount) => setDraft({ ...draft, amount })}
            keyboardType="decimal-pad"
            prefix="$"
            hint="Including GST, as printed"
          />
        </View>
      </View>
      <Choice
        label="GST"
        value={draft.gstFree ? 'free' : 'taxable'}
        onChange={(v) => setDraft({ ...draft, gstFree: v === 'free' })}
        options={[
          { value: 'taxable', label: 'Taxable' },
          { value: 'free', label: 'GST-free' },
        ]}
      />
    </>
  );
}
