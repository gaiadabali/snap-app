import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Card, Divider, Figure, Label, Screen, Small } from '@/components/ui';
import { CONFIRM_BLOCKED_COPY, displayValue, type Preview } from '@/lib/provisional';
import { radius, space, usePalette } from '@/theme';

/**
 * What the phone read, on screen before the server has answered.
 *
 * THE WHOLE POINT OF STAGE 1, and the part that was missing. The first cut of
 * OD-8 computed the preview at the shutter, sent it to OD-7, and then waited
 * on `awaitExtraction` before navigating anywhere — so the numbers the phone
 * had already read sat in a variable until the server produced its own. On the
 * handset, extraction timed out and the person saw nothing at all; with this,
 * they would have seen the total immediately.
 *
 * Every value here is PROVISIONAL and says so twice: a dashed rule beneath it
 * and a chip, because colour alone is not a signal to everybody. §7.1 reserves
 * `scan` cyan for exactly this — never `good`, never `risk`. This is not a
 * result, it is a machine's first guess shown while a better reader works.
 *
 * CONFIRM DOES NOT EXIST HERE. Not disabled — absent. §7.1: "these are not
 * disabled affordances, they are code paths that do not exist on the preview
 * screen." There is nothing on this screen that can post to the ledger, set
 * `is_tax_invoice` or produce a BAS figure, and the reason is written where
 * somebody about to add one will read it.
 */

const ROWS: Array<{ path: keyof Preview & string; label: string }> = [
  { path: 'header.supplier', label: 'Supplier' },
  { path: 'header.issue_date', label: 'Date' },
  { path: 'header.tax_amount', label: 'GST' },
  { path: 'header.supplier_abn', label: 'ABN' },
];

export function ProvisionalReview({
  preview,
  stillWaiting = false,
}: {
  preview: Preview;
  /** The wait for the server's read gave up. Not an error — see below. */
  stillWaiting?: boolean;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const total = displayValue(preview['header.payable_amount']);
  const rows = ROWS.map((r) => ({ ...r, value: displayValue(preview[r.path]) })).filter(
    // An abstention is shown as nothing, not as a blank row. The structurer
    // declining to read a field is information the server will settle in a
    // moment; a row of dashes just makes the screen look broken.
    (r) => r.value !== null,
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.md,
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <ActivityIndicator color={p.scan} />
          <Label style={{ color: p.scan, flex: 1 }}>Provisional · read on this phone</Label>
        </View>

        <View style={{ gap: space.xs }}>
          <Small>Total</Small>
          {total === null ? (
            <Figure size="h1" style={{ color: p.inkFaint }}>
              —
            </Figure>
          ) : (
            <View style={{ alignSelf: 'flex-start' }}>
              <Figure size="h1">{total}</Figure>
              {/* The dashed rule. Two signals, not one. */}
              <View style={{ height: 2, borderBottomWidth: 2, borderStyle: 'dashed', borderColor: p.scan }} />
            </View>
          )}
        </View>

        {rows.length > 0 ? (
          <Card>
            <View style={{ gap: space.sm }}>
              {rows.map((r, i) => (
                <View key={r.path}>
                  {i > 0 ? <Divider style={{ marginBottom: space.sm }} /> : null}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                    <Small>{r.label}</Small>
                    <Body>{r.value}</Body>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <View
          style={{
            padding: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: p.scan,
            gap: space.xs,
          }}
        >
          <Label style={{ color: p.scan }}>Provisional</Label>
          <Small>
            Read on this phone while the receipt uploads. The server is reading it too, and its
            answer is the one that gets kept — anything it disagrees with will be shown to you.
          </Small>
        </View>

        <Small>{CONFIRM_BLOCKED_COPY}</Small>

        {stillWaiting ? (
          // The wait timed out. The capture is stored and the document will
          // appear in the review list; saying so is honest and saying "failed"
          // would not be. This is the state the handset actually reached when
          // extraction was slow, and it is the one that used to show nothing.
          <Small>
            The server is taking longer than usual. Your receipt is saved — it will appear in
            your receipts when it is read.
          </Small>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
