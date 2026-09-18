import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { api, type DocumentView } from '@/api';
import { Choice, Field, Sheet } from '@/components/form';
import { Body, Small } from '@/components/ui';
import { gstFromInclusive } from '@/lib/money';
import { space, usePalette } from '@/theme';

/**
 * Correcting the fields extraction got wrong.
 *
 * Three of these were editable before — the ABN, the supplier and the date —
 * and everything else was read-only. That is exactly backwards from what
 * testing a vision model showed: the fields it gets wrong are the AMOUNT and
 * the DATE. One model read a docket dated 06/09/26 as the year 2006, which
 * would file the receipt twenty years out and quietly drop it from the BAS.
 * A review screen that cannot fix the total is not a review screen.
 *
 * Editing the total re-derives the GST at exactly 1/11 rather than asking for
 * it: a human retyping both invites them to disagree, and the ATO's figure is
 * the arithmetic one.
 */

const CATEGORIES_BUSINESS = [
  'Fuel',
  'Truck parts & maintenance',
  'Meals on the road',
  'Accommodation',
  'Tolls',
  'Phone & internet',
  'Protective clothing',
  'Truck cleaning supplies',
  'Insurance',
  'Laundry on the road',
];

const CATEGORIES_PERSONAL = [
  'Groceries',
  'Eating out',
  'Transport',
  'Fuel',
  'Bills & utilities',
  'Health',
  'Shopping',
  'Home',
  'Fun',
];

export function EditFields({
  doc,
  onChange,
}: {
  doc: DocumentView;
  onChange: (next: DocumentView) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    supplierName: doc.supplierName,
    issueDate: doc.issueDate,
    total: Number(doc.payableAmount).toFixed(2),
    gstFree: doc.gstFreeAmount ? Number(doc.gstFreeAmount).toFixed(2) : '',
    category: doc.category,
  });

  const categories = doc.workspace === 'business' ? CATEGORIES_BUSINESS : CATEGORIES_PERSONAL;
  const options = categories.includes(doc.category) ? categories : [doc.category, ...categories];

  /** A date the app is willing to believe. */
  function dateProblem(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Use the form 2026-09-06.';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(+d)) return 'That is not a real date.';
    const now = new Date();
    if (d > new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) {
      return 'That date is in the future.';
    }
    // Records must be kept five years; older than seven is almost certainly a
    // misread century or a two-digit year — the failure the model actually
    // makes. Cheap to check, and it catches a twenty-year error.
    if (d < new Date(now.getFullYear() - 7, now.getMonth(), now.getDate())) {
      return 'That is more than seven years ago — check the year on the receipt.';
    }
    return null;
  }

  const total = Number(draft.total);
  const gstFree = draft.gstFree === '' ? 0 : Number(draft.gstFree);
  const problems: string[] = [];
  if (!draft.supplierName.trim()) problems.push('The supplier needs a name.');
  const dp = dateProblem(draft.issueDate);
  if (dp) problems.push(dp);
  if (!(total > 0)) problems.push('The total must be more than zero.');
  if (gstFree < 0 || gstFree > total) problems.push('The GST-free part cannot exceed the total.');

  // Shown live, so the consequence of a correction is visible before saving.
  // Australia-specific: 82.50 tax-invoice threshold below is an ATO figure,
  // so this whole edit flow is AU-only for now. Will need the tenant's
  // installed tax rule set's inclusiveFraction once this surface goes
  // multi-jurisdiction.
  const newGst = total > 0 ? gstFromInclusive((total - gstFree).toFixed(4), { n: 1, d: 11 }) : '0.0000';

  async function save() {
    setError(null);
    try {
      let next = await api().updateDocument(doc.id, {
        edits: {
          'supplier.name': draft.supplierName.trim(),
          'header.issue_date': draft.issueDate,
          'totals.payable': (Math.round(total * 100) / 100).toFixed(4),
          'totals.gst_free': draft.gstFree === '' ? null : (Math.round(gstFree * 100) / 100).toFixed(4),
          'header.category': draft.category,
        },
      });
      next = next ?? doc;
      onChange(next);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save those corrections.');
    }
  }

  function reject() {
    Alert.alert(
      'Reject this scan?',
      'It is withdrawn from your lists. The photo itself is kept — it is the record a business has to hold for five years — so this rejects the reading, not the evidence.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            void api()
              .rejectDocument(doc.id, 'Rejected during review')
              .then(() => onChange({ ...doc, reviewStatus: 'rejected' }));
          },
        },
      ],
    );
  }

  return (
    <>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(null);
            setDraft({
              supplierName: doc.supplierName,
              issueDate: doc.issueDate,
              total: Number(doc.payableAmount).toFixed(2),
              gstFree: doc.gstFreeAmount ? Number(doc.gstFreeAmount).toFixed(2) : '',
              category: doc.category,
            });
            setOpen(true);
          }}
          style={({ pressed }) => ({
            flex: 2,
            paddingVertical: 13,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: pressed ? p.accent : p.ruleStrong,
            alignItems: 'center',
          })}
        >
          <Body strong style={{ color: p.accent }}>
            Correct the details
          </Body>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={reject}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: 13,
            borderRadius: 12,
            borderWidth: 1.5,
            borderColor: pressed ? p.risk : p.rule,
            alignItems: 'center',
          })}
        >
          <Body strong style={{ color: p.risk }}>
            Reject
          </Body>
        </Pressable>
      </View>

      <Sheet
        open={open}
        title="Correct the details"
        subtitle="Check each against the image."
        error={error ?? (problems.length > 0 && open ? problems[0] : null)}
        submitLabel="Save corrections"
        submitDisabled={problems.length > 0}
        onClose={() => setOpen(false)}
        onSubmit={save}
      >
        <Field
          label="Supplier"
          value={draft.supplierName}
          onChangeText={(supplierName) => setDraft({ ...draft, supplierName })}
        />
        <Field
          label="Date on the receipt"
          value={draft.issueDate}
          onChangeText={(issueDate) => setDraft({ ...draft, issueDate })}
          placeholder="2026-09-06"
          hint="Australian receipts print day/month/year — 06/09/26 is 6 September."
        />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Total"
              value={draft.total}
              onChangeText={(t) => setDraft({ ...draft, total: t })}
              keyboardType="decimal-pad"
              prefix="$"
              hint="Including GST"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="GST-free part"
              value={draft.gstFree}
              onChangeText={(g) => setDraft({ ...draft, gstFree: g })}
              keyboardType="decimal-pad"
              prefix="$"
              hint="Fresh food etc."
            />
          </View>
        </View>

        <View
          style={{
            backgroundColor: p.accentSoft,
            borderRadius: 12,
            padding: space.md,
            gap: 2,
          }}
        >
          <Small muted={false} style={{ color: p.accent, fontWeight: '700' }}>
            GST becomes ${Number(newGst).toFixed(2)}
          </Small>
          <Small>
            Recalculated as exactly 1/11 of the taxable part. You never type the GST — the ATO
            figure is the arithmetic one.
          </Small>
        </View>

        <Choice
          label="Category"
          value={draft.category}
          onChange={(category) => setDraft({ ...draft, category })}
          options={options.map((c) => ({ value: c, label: c }))}
        />
      </Sheet>
    </>
  );
}

/** Kept for the review screen's compliance card. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  return <Text>{children}</Text>;
}
