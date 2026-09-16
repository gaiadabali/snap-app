import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, TextInput, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { abnIsValid, api, type DocumentLine, type DocumentView, type Permissions } from '@/api';
import { Avatar } from '@/components/form';
import { EditFields } from '@/components/EditFields';
import { Findings } from '@/components/Findings';
import { LineItems } from '@/components/LineItems';
import { BalanceNote, OriginalDocument } from '@/components/receipt';
import {
  Body,
  Button,
  Card,
  Chip,
  ConfidenceDots,
  Divider,
  Figure,
  Label,
  Screen,
  Small,
} from '@/components/ui';
import { formatAbn, formatAud, formatShortDate, radius, space, usePalette } from '@/theme';

/** Plain-English explanation of each ATO failure, plus the fix. */
const FAILURE_COPY: Record<string, { title: string; detail: string; fix: string }> = {
  supplier_abn_missing: {
    title: 'No supplier ABN',
    detail:
      'A tax invoice must show the seller’s ABN. Without it the GST credit cannot be claimed, and the payer may also have to withhold under the no-ABN rules.',
    fix: 'Add the ABN from the docket, or ask the supplier for a compliant tax invoice.',
  },
  buyer_abn_required_over_1000: {
    title: 'Buyer ABN required over $1,000',
    detail:
      'For a sale of $1,000 or more including GST, the invoice must also show the buyer’s identity or ABN. This one does not.',
    fix: 'Ask the supplier to reissue the invoice showing your business name or ABN.',
  },
  not_marked_tax_invoice: {
    title: 'Not marked “tax invoice”',
    detail:
      'The words “tax invoice” must appear prominently on the document, or it must otherwise meet the ATO’s tax-invoice requirements.',
    fix: 'Request a tax invoice from the supplier.',
  },
};

export default function DocumentScreen() {
  const p = usePalette();
  const router = useRouter();
  const { id, localPages } = useLocalSearchParams<{ id: string; localPages?: string }>();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<null | 'abn'>(null);
  const [draft, setDraft] = useState('');
  const [perms, setPerms] = useState<Permissions | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const next = await api().getDocument(id);
    setDoc(next);
    if (next) setPerms(await api().getPermissions(next.workspaceId));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A page image's signed URL is short-TTL (~15 minutes, §8 of the
   * multi-page capture contract) and this screen has no way to know it
   * expired other than `<Image>` failing to load it. The fix is a fresh
   * `DocumentView` — refetching mints a new token.
   *
   * Guarded by the URL that failed, not a plain boolean: if the refetch's
   * own fresh URL somehow fails too (offline, a real 404), that is a
   * DIFFERENT url and gets exactly one retry of its own rather than either
   * looping forever or refusing to ever try again for the rest of the
   * screen's life. `OriginalDocument` already falls back to the facsimile
   * on its own the moment a load fails, so there is no broken image on
   * screen while this happens in the background.
   */
  const refetchedForUrlRef = useRef<string | null>(null);
  const handleImageExpired = useCallback(
    (failedUrl: string) => {
      if (refetchedForUrlRef.current === failedUrl) return;
      refetchedForUrlRef.current = failedUrl;
      void load();
    },
    [load],
  );

  if (!doc) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Small>Loading…</Small>
        </View>
      </Screen>
    );
  }

  const failures = doc.complianceFailures ?? [];
  const atRisk = !doc.isTaxInvoice;

  // `doc` is non-null from here down; capture it so the closures below do not
  // each need their own narrowing.
  const current: DocumentView = doc;
  const canEdit = perms?.canEdit ?? false;
  const canConfirm = perms?.canConfirm ?? false;

  // Passed by the capture screen right after a multi-page shoot, since these
  // are still on-device and faster than a round trip. Reopening this document
  // later — no param — pages through `doc.pages` instead, which the server
  // now hands back for exactly this reason (§3.1 of the multi-page capture
  // contract).
  let localPageUris: string[] | undefined;
  if (localPages) {
    try {
      const parsed: unknown = JSON.parse(localPages);
      if (Array.isArray(parsed) && parsed.every((u) => typeof u === 'string')) {
        localPageUris = parsed;
      }
    } catch {
      // A malformed param is not worth failing the screen over — it just
      // means the pager falls back to the single image, same as normal.
    }
  }

  async function toggleVisibility() {
    setBusy(true);
    const next = await api().setVisibility(
      current.id,
      current.visibility === 'private' ? 'shared' : 'private',
    );
    setDoc(next);
    setBusy(false);
  }

  async function saveAbn() {
    const cleaned = draft.replace(/\D/g, '');
    if (!abnIsValid(cleaned)) {
      // Fail here rather than storing a number that will not survive the
      // database's own mod-89 check.
      Alert.alert(
        'That ABN fails its checksum',
        'An ABN is 11 digits and must satisfy the ATO’s modulus-89 check. Please re-read the digits from the receipt.',
      );
      return;
    }
    setBusy(true);
    setEditing(null);
    const next = await api().updateDocument(current.id, { edits: { 'supplier.abn': cleaned } });
    setDoc(next);
    setBusy(false);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* haptics unavailable */
    }
  }

  async function confirm() {
    setBusy(true);
    const next = await api().confirmDocument(current.id);
    setDoc(next);
    setBusy(false);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* haptics unavailable */
    }
    router.back();
  }

  return (
    <Screen>
      <Animated.ScrollView
        // A capture landing: this document just arrived from the shutter
        // (`localPages` is only ever passed by the capture screen), so the
        // review fields settle in rather than snapping onto the screen.
        // Reopening the same document later carries no `localPages` and gets
        // no entrance at all — nothing to animate, because nothing changed.
        entering={localPages ? FadeInUp.duration(320) : undefined}
        contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxxl }}
      >
        {/* ── Header ── */}
        <View style={{ gap: space.xs }}>
          <Label>{doc.category}</Label>
          <Figure size="h1">{doc.supplierName}</Figure>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Small>{formatShortDate(doc.issueDate)}</Small>
            <ConfidenceDots value={doc.confidenceOverall} />
            <Small>{Math.round(doc.confidenceOverall * 100)}% confident</Small>
          </View>

          {doc.capturedByName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: 2 }}>
              <Avatar initials={initialsOf(doc.capturedByName)} size={24} />
              <Small>Captured by {doc.capturedByName}</Small>
              {doc.visibility === 'private' ? <Chip>Private</Chip> : null}
            </View>
          ) : null}
        </View>

        {/* ── The original, then what was read off it ── */}
        <OriginalDocument doc={doc} localPages={localPageUris} onImageExpired={handleImageExpired} />

        {doc.demoExtraction ? (
          <Card tone="risk">
            <View style={{ gap: space.xs }}>
              <Label style={{ color: p.risk }}>Demo extraction</Label>
              <Body>
                Your photo was captured, hashed and would be uploaded as the original. The FIELDS
                below are sample data — the extraction service is not built yet, so they do not
                describe this particular receipt.
              </Body>
            </View>
          </Card>
        ) : null}

        <BalanceNote doc={doc} />

        <LineItems
          lines={doc.lines}
          category={doc.category}
          editable={canEdit && doc.reviewStatus !== 'reviewed'}
          onChange={async (lines: DocumentLine[]) => {
            const next = await api().updateLines(current.id, lines);
            setDoc(next);
          }}
        />

        {/* ── Amounts ── */}
        <Card>
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Label>Total incl GST</Label>
              <Figure size="h1">{formatAud(doc.payableAmount)}</Figure>
            </View>
            <Divider />
            <Field label="Excluding GST" value={formatAud(doc.taxExclusiveAmount)} />
            <Field label="GST" value={formatAud(doc.taxAmount)} hint="Exactly 1/11 of the taxable amount" />
            {doc.taxSubtotals.length > 1 ? (
              /* ── The split, and the reason this product exists ──
                 One docket, two tax treatments. Hubdoc, Dext, myDeductions and
                 Ozly all read a header total, so none of them can say which
                 half is claimable (docs/MONETISATION.md §2). Shown as its own
                 block rather than a footnote because it IS the feature.

                 Every figure here is sent by the server. The screen adds
                 nothing — docs/DESIGN-HANDOFF.md §3. */
              <>
                <Divider />
                <Label>Split by tax treatment</Label>
                {doc.taxSubtotals.map((s) => (
                  <Field
                    key={s.categoryCode}
                    label={s.categoryCode === 'Z' ? 'GST-free' : 'Taxable'}
                    value={formatAud(s.inclusiveAmount)}
                    hint={
                      s.categoryCode === 'Z'
                        ? 'Fresh food and other GST-free items. No GST to claim on this portion.'
                        : `Carries ${formatAud(s.taxAmount)} of GST`
                    }
                  />
                ))}
              </>
            ) : doc.gstFreeAmount ? (
              <Field
                label="GST-free portion"
                value={formatAud(doc.gstFreeAmount)}
                hint="Fresh food and other GST-free items, separated from the taxable total"
              />
            ) : null}
          </View>
        </Card>

        {/* The deterministic checks, before the compliance verdict they
            produced — a reader wants the reason before the conclusion. */}
        <Findings findings={doc.findings} />

        {/* ── Compliance: the reason this screen exists ── */}
        {atRisk ? (
          <Card tone="risk">
            <View style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Label style={{ color: p.risk }}>GST credit at risk</Label>
                <Figure size="h2" tone="risk">
                  {formatAud(doc.taxAmount)}
                </Figure>
              </View>
              {doc.belowTaxInvoiceThreshold ? (
                <Body>
                  This is under $82.50 including GST, so the ATO does not require a tax invoice —
                  but you still need a record showing the supplier and what you bought.
                </Body>
              ) : null}
              {failures.map((f) => {
                const copy = FAILURE_COPY[f];
                if (!copy) return null;
                return (
                  <View key={f} style={{ gap: 4 }}>
                    <Body strong>{copy.title}</Body>
                    <Small muted={false}>{copy.detail}</Small>
                    <Small style={{ color: p.risk, fontWeight: '600' }}>{copy.fix}</Small>
                  </View>
                );
              })}
              {failures.some((f) => f === 'supplier_abn_missing') ? (
                <Button
                  label="Add supplier ABN"
                  tone="risk"
                  onPress={() => {
                    setDraft(doc.supplierAbn ?? '');
                    setEditing('abn');
                  }}
                />
              ) : null}
            </View>
          </Card>
        ) : (
          <Card tone="accent">
            <View style={{ gap: space.xs }}>
              <Label style={{ color: p.accent }}>Valid tax invoice</Label>
              <Body>
                Meets the ATO requirements, so the {formatAud(doc.taxAmount)} GST credit is
                claimable at label 1B.
              </Body>
            </View>
          </Card>
        )}

        {/* Correcting a field is the point of this screen, so the control sits
            with the fields rather than at the bottom of the page. */}
        {canEdit && doc.reviewStatus !== 'reviewed' ? (
          <EditFields doc={current} onChange={(next) => setDoc(next)} />
        ) : null}

        {/* ── Extracted fields ── */}
        <Card>
          <View style={{ gap: space.md }}>
            <Label>Extracted fields</Label>
            <Divider />
            <Field
              label="Supplier ABN"
              value={formatAbn(doc.supplierAbn)}
              tone={doc.supplierAbnValid ? 'ink' : 'risk'}
              hint={
                doc.supplierAbnValid
                  ? 'Passes the ATO modulus-89 checksum'
                  : 'Missing or fails the checksum'
              }
            />
            <Field label="Document type" value={doc.isTaxInvoice ? 'Tax invoice' : 'Receipt'} />
            <Field label="Issue date" value={doc.issueDate} />
            <Field label="Currency" value={doc.currency} />
            <Field
              label="Deduction row"
              value={doc.engineRowId}
              hint="Where this lands on the tax worksheet for this occupation"
            />
          </View>
        </Card>

        {doc.note ? (
          <Card>
            <View style={{ gap: space.xs }}>
              <Label>Note</Label>
              <Body muted>{doc.note}</Body>
            </View>
          </Card>
        ) : null}

        {/* ── Privacy, in the personal workspace only ── */}
        {doc.workspace === 'personal' ? (
          <Card>
            <View style={{ gap: space.sm }}>
              <Label>Visible to</Label>
              <Body>
                {doc.visibility === 'private'
                  ? 'Only you. It still counts toward the household total, but the merchant and category are hidden from everyone else.'
                  : 'Everyone in this household.'}
              </Body>
              <Button
                label={doc.visibility === 'private' ? 'Share with the household' : 'Make private'}
                tone="outline"
                onPress={() => void toggleVisibility()}
                disabled={busy}
              />
            </View>
          </Card>
        ) : null}

        {/* ── Confirm ── */}
        <View style={{ gap: space.md }}>
          {doc.reviewStatus === 'rejected' ? (
            <Card tone="risk">
              <View style={{ gap: space.xs }}>
                <Label style={{ color: p.risk }}>Rejected</Label>
                <Body>
                  Withdrawn from your lists and excluded from the BAS. The original image is still
                  held as the record.
                </Body>
              </View>
            </Card>
          ) : doc.reviewStatus === 'reviewed' ? (
            <Chip tone="accent">Confirmed — posted to the ledger</Chip>
          ) : canConfirm ? (
            <>
              <Button
                label="Confirm and post"
                onPress={() => void confirm()}
                busy={busy}
                disabled={busy}
              />
              <Small style={{ textAlign: 'center' }}>
                Confirming locks the fields you have checked. A later re-extraction cannot
                overwrite them — if a better model disagrees, it raises a review task instead.
              </Small>
            </>
          ) : (
            <Card>
              <View style={{ gap: space.xs }}>
                <Label>Waiting on an owner</Label>
                <Body>
                  You can capture and correct in this workspace, but posting to the ledger is an
                  owner or manager action. Your corrections are saved and visible to them.
                </Body>
              </View>
            </Card>
          )}
        </View>
      </Animated.ScrollView>

      {/* ── ABN edit sheet ── */}
      <Modal visible={editing === 'abn'} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: p.overlay, justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: p.ground,
              padding: space.xl,
              gap: space.lg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
            }}
          >
            <Figure size="h2">Supplier ABN</Figure>
            <Small>
              11 digits, as printed on the receipt. It is checked against the ATO’s modulus-89
              algorithm before saving — the same check the database enforces.
            </Small>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              keyboardType="number-pad"
              maxLength={14}
              autoFocus
              placeholder="51 824 753 556"
              placeholderTextColor={p.inkFaint}
              style={{
                borderWidth: 2,
                borderColor: abnIsValid(draft) ? p.accent : p.rule,
                borderRadius: radius.md,
                padding: space.md,
                fontSize: 20,
                color: p.ink,
                backgroundColor: p.surface,
              }}
            />
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Button
                label="Cancel"
                tone="outline"
                onPress={() => setEditing(null)}
                style={{ flex: 1 }}
              />
              <Button
                label="Save"
                onPress={() => void saveAbn()}
                disabled={!abnIsValid(draft)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** Two letters for the avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Field({
  label,
  value,
  hint,
  tone = 'ink',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ink' | 'risk' | 'accent';
}) {
  return (
    <View style={{ gap: 2 }}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: space.md,
        }}
      >
        <Body muted style={{ flexShrink: 1 }}>
          {label}
        </Body>
        <Figure tone={tone}>{value}</Figure>
      </View>
      {hint ? <Small>{hint}</Small> : null}
    </View>
  );
}
