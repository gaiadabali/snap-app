'use client';

import { useActionState, useState, useTransition } from 'react';
import type { DocumentView, Permissions } from '@snap/api-contract';

import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Money,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
  Thead,
  Tr,
} from '@/design/primitives';
import { formatConfidence, formatDateTime, reviewStatusLabel } from '@/lib/panels/format';
import {
  confirmDocument as confirmDocumentAction,
  rejectDocument as rejectDocumentAction,
  setVisibility as setVisibilityAction,
  updateDocument as updateDocumentAction,
} from '@/lib/panels/document-actions';
import { draftTransactionFromDocument } from '@/lib/panels/ledger-actions';
import type { ActionResult } from '@/lib/panels/actions';

const FINDING_TONE = { error: 'risk', warning: 'warn', note: 'neutral' } as const;

/**
 * The review queue's flagship screen.
 *
 * The image and the extracted fields sit side by side deliberately — the
 * whole point of a wide screen over the mobile app's cramped review panel.
 * Editing and confirming are two physically separate forms with two separate
 * buttons, never one "Save": `docs/PLAN.md` §5.1 draws that line in the data
 * model (edit vs. confirm are separately audited, and only confirming posts),
 * and blurring it into one action here would hide exactly the distinction
 * the ticket asked this screen to make obvious.
 */
export function ReviewDocument({
  document,
  imageBaseUrl,
  permissions,
  workspaceId,
  path,
  listPath,
  isBusiness,
}: {
  document: DocumentView;
  /** The API origin — images are served from there directly, token-authenticated. */
  imageBaseUrl: string;
  permissions: Permissions;
  workspaceId: string;
  path: string;
  listPath: string;
  isBusiness: boolean;
}) {
  const boundUpdate = updateDocumentAction.bind(null, workspaceId, document.id, path);
  const boundReject = rejectDocumentAction.bind(null, workspaceId, document.id, path, listPath);

  const [updateState, updateFormAction, updatePending] = useActionState<ActionResult | null, FormData>(
    boundUpdate,
    null,
  );
  const [rejectState, rejectFormAction, rejectPending] = useActionState<ActionResult | null, FormData>(
    boundReject,
    null,
  );
  const [confirmPending, startConfirm] = useTransition();
  const [confirmResult, setConfirmResult] = useState<ActionResult | null>(null);
  const [draftPending, startDraft] = useTransition();
  const [draftResult, setDraftResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [visPending, startVis] = useTransition();
  const [visibility, setVisibilityLocal] = useState(document.visibility);

  const findingsFor = (field: string) => document.findings.filter((f) => f.field === field);
  const confirmed = document.reviewStatus === 'reviewed' || document.reviewStatus === 'auto_accepted';
  const rejected = document.reviewStatus === 'rejected';
  const isNeedsReview = document.reviewStatus === 'needs_review';
  const pages = document.pages.length > 0 ? document.pages : document.imageUrl ? [{ pageNumber: 0, imageUrl: document.imageUrl, source: 'capture' as const }] : [];
  const [activePage, setActivePage] = useState(0);
  const activeImage = pages[activePage];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-bold text-[var(--color-ink)]">{document.supplierName}</h1>
            <Badge tone={rejected ? 'risk' : confirmed ? 'good' : 'warn'}>
              {reviewStatusLabel(document.reviewStatus)}
            </Badge>
            {isBusiness ? (
              document.isTaxInvoice ? (
                <Badge tone="good">Valid tax invoice</Badge>
              ) : (
                <Badge tone="risk">Not a valid tax invoice</Badge>
              )
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            Overall confidence {formatConfidence(document.confidenceOverall)} · captured by{' '}
            {document.capturedByName ?? 'someone since removed'}
            {document.imageCapturedAt ? ` · ${formatDateTime(document.imageCapturedAt)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[var(--color-ink-muted)]">Shared with workspace</span>
          <Switch
            checked={visibility === 'shared'}
            pending={visPending}
            label="Share this document with the rest of the workspace"
            onCheckedChange={(next) => {
              const value = next ? 'shared' : 'private';
              setVisibilityLocal(value);
              startVis(async () => {
                await setVisibilityAction(workspaceId, document.id, path, value);
              });
            }}
          />
        </div>
      </div>

      {document.findings.length > 0 ? (
        <div className="flex flex-col gap-2">
          {document.findings.map((f, i) => (
            <div
              key={`${f.code}-${i}`}
              className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-[13px]"
            >
              <Badge tone={FINDING_TONE[f.severity]}>{f.severity}</Badge>
              <div>
                <span className="font-medium text-[var(--color-ink)]">{f.field}: </span>
                <span className="text-[var(--color-ink-muted)]">{f.message}</span>
                {f.fix ? <span className="block text-[var(--color-accent)]">{f.fix}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!document.linesBalance && document.lines.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] px-3 py-2 text-[13px] text-[var(--color-risk)]">
          The lines do not add up to the total on this document — fix a line or the total before sending it to the ledger.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Image ──────────────────────────────────────────────────── */}
        <Card className="flex flex-col gap-3">
          <div
            className={
              isNeedsReview
                ? 'scan-line relative overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-ground)]'
                : 'relative overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-ground)]'
            }
          >
            {activeImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${imageBaseUrl}${activeImage.imageUrl}`}
                alt={`${document.supplierName} — page ${activePage + 1}`}
                className="max-h-[640px] w-full object-contain"
              />
            ) : (
              <div className="flex h-[300px] items-center justify-center text-[13px] text-[var(--color-ink-faint)]">
                No image on file
              </div>
            )}
          </div>
          {pages.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {pages.map((p, i) => (
                <button
                  key={p.pageNumber}
                  type="button"
                  onClick={() => setActivePage(i)}
                  className={
                    i === activePage
                      ? 'rounded-[var(--radius-sm)] border-2 border-[var(--color-accent)] px-2 py-1 text-[12px] font-semibold text-[var(--color-accent)]'
                      : 'rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-2 py-1 text-[12px] text-[var(--color-ink-muted)]'
                  }
                >
                  Page {i + 1}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[12px] text-[var(--color-ink-faint)]">
            The original, exactly as captured — this is the legal record and is never edited or re-rendered.
          </p>
        </Card>

        {/* ── Fields ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <Card>
            <form action={updateFormAction} className="flex flex-col gap-4">
              <input type="hidden" name="version" value={document.version} />
              <Field label="Supplier">
                <Input name="supplierName" defaultValue={document.supplierName} disabled={!permissions.canEdit} />
              </Field>
              {findingsFor('supplierName').map((f, i) => (
                <FieldNote key={i} finding={f} />
              ))}

              {isBusiness ? (
                <>
                  <Field
                    label="Supplier ABN"
                    hint={document.supplierAbn ? (document.supplierAbnValid ? 'Valid ABN' : 'Fails the ATO checksum') : 'No ABN on this receipt'}
                  >
                    <Input name="supplierAbn" defaultValue={document.supplierAbn ?? ''} disabled={!permissions.canEdit} placeholder="11 digits" />
                  </Field>
                  {findingsFor('supplierAbn').map((f, i) => (
                    <FieldNote key={i} finding={f} />
                  ))}
                </>
              ) : null}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Issue date">
                  <Input type="date" name="issueDate" defaultValue={document.issueDate} disabled={!permissions.canEdit} />
                </Field>
                <Field label="Total paid">
                  <Input name="payableAmount" defaultValue={document.payableAmount} disabled={!permissions.canEdit} inputMode="decimal" />
                </Field>
              </div>
              {findingsFor('issueDate').map((f, i) => (
                <FieldNote key={i} finding={f} />
              ))}
              {findingsFor('payableAmount').map((f, i) => (
                <FieldNote key={i} finding={f} />
              ))}

              {isBusiness ? (
                <Field label="Of which GST-free" hint="Fresh food and some health items carry no GST at all.">
                  <Input name="gstFreeAmount" defaultValue={document.gstFreeAmount ?? ''} disabled={!permissions.canEdit} inputMode="decimal" />
                </Field>
              ) : null}

              {isBusiness ? (
                <div className="grid grid-cols-2 gap-4 rounded-[var(--radius-md)] bg-[var(--color-surface)] p-3 text-[13px]">
                  <div>
                    <div className="text-[var(--color-ink-faint)]">GST on this document</div>
                    <div className="font-semibold text-[var(--color-ink)]">
                      <Money amount={document.taxAmount} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[var(--color-ink-faint)]">Claimable now</div>
                    <div className={document.isTaxInvoice ? 'font-semibold text-[var(--color-good)]' : 'font-semibold text-[var(--color-risk)]'}>
                      {document.isTaxInvoice ? <Money amount={document.taxAmount} /> : <Money amount="0" />}
                    </div>
                  </div>
                </div>
              ) : null}

              {!permissions.canEdit ? (
                <p className="text-[13px] text-[var(--color-ink-muted)]">Your role here is read-only.</p>
              ) : updateState && !updateState.ok ? (
                <p className="text-[13px] text-[var(--color-risk)]">{updateState.message}</p>
              ) : updateState?.ok ? (
                <p className="text-[13px] text-[var(--color-good)]">Saved.</p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" variant="secondary" disabled={!permissions.canEdit || updatePending}>
                  {updatePending ? 'Saving…' : 'Save corrections'}
                </Button>
              </div>
            </form>
          </Card>

          {document.lines.length > 0 ? (
            <Card>
              <h3 className="mb-3 text-[14px] font-semibold text-[var(--color-ink)]">Lines, as extracted</h3>
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <Th>Description</Th>
                    <Th align="right">Qty</Th>
                    <Th align="right">Amount</Th>
                    {isBusiness ? <Th>GST-free</Th> : null}
                    <Th align="right">Confidence</Th>
                  </Thead>
                  <tbody>
                    {document.lines.map((l) => (
                      <Tr key={l.lineNumber}>
                        <Td>{l.description}</Td>
                        <Td align="right">{l.quantity}</Td>
                        <Td align="right">
                          <Money amount={l.amount} />
                        </Td>
                        {isBusiness ? <Td>{l.gstFree ? 'Yes' : 'No'}</Td> : null}
                        <Td align="right">{formatConfidence(l.confidence)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          ) : null}

          {/* ── Confirm / reject — separate from editing on purpose ──── */}
          <Card tone="accent">
            <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">
              {confirmed ? 'Confirmed' : 'Confirm this document'}
            </h3>
            <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              {confirmed
                ? 'The fields above are locked against a later re-extraction overwriting them. A better model run may still flag a disagreement for review — it will never silently replace what a person confirmed.'
                : 'Confirming locks today’s values against a later re-scan and is a separate, audited act from editing — it does not happen when you save a correction above.'}
            </p>
            {confirmResult && !confirmResult.ok ? (
              <p className="mt-2 text-[13px] text-[var(--color-risk)]">{confirmResult.message}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!confirmed && !rejected ? (
                <Button
                  disabled={!permissions.canConfirm || confirmPending}
                  onClick={() =>
                    startConfirm(async () => {
                      const result = await confirmDocumentAction(workspaceId, document.id, path);
                      setConfirmResult(result);
                    })
                  }
                >
                  {confirmPending ? 'Confirming…' : 'Confirm document'}
                </Button>
              ) : null}
              {!permissions.canConfirm && !confirmed ? (
                <span className="text-[13px] text-[var(--color-ink-muted)]">
                  Posting to the ledger is an owner or manager action — ask one to confirm this.
                </span>
              ) : null}

              {isBusiness && confirmed ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={draftPending || !document.linesBalance}
                    onClick={() =>
                      startDraft(async () => {
                        const result = await draftTransactionFromDocument(workspaceId, document.id, path);
                        setDraftResult(
                          result.ok
                            ? { ok: true, message: `Draft transaction ${result.transactionId} created — post it from the Ledger.` }
                            : { ok: false, message: result.message ?? 'Could not draft a transaction.' },
                        );
                      })
                    }
                  >
                    {draftPending ? 'Sending…' : 'Send to ledger (draft)'}
                  </Button>
                  {draftResult ? (
                    <span className={draftResult.ok ? 'text-[13px] text-[var(--color-good)]' : 'text-[13px] text-[var(--color-risk)]'}>
                      {draftResult.message}
                    </span>
                  ) : null}
                </>
              ) : null}

              {!rejected && !showReject ? (
                <Button variant="ghost" size="sm" disabled={!permissions.canEdit} onClick={() => setShowReject(true)}>
                  This isn’t a real receipt
                </Button>
              ) : null}
            </div>

            {showReject ? (
              <form action={rejectFormAction} className="mt-3 flex flex-col gap-2 border-t border-[var(--color-rule-strong)] pt-3">
                <Field label="Why reject it?" error={rejectState && !rejectState.ok ? rejectState.message : undefined}>
                  <Textarea
                    name="reason"
                    rows={2}
                    placeholder="e.g. duplicate of another scan, blank page, not a receipt"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="danger" size="sm" disabled={rejectPending}>
                    {rejectPending ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowReject(false)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[12px] text-[var(--color-ink-faint)]">
                  The image stays on file — a business must keep the record for five years even when the extraction was wrong.
                </p>
              </form>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

function FieldNote({ finding }: { finding: DocumentView['findings'][number] }) {
  return (
    <p className={`text-[12px] ${finding.severity === 'error' ? 'text-[var(--color-risk)]' : 'text-[var(--color-warn)]'}`}>
      {finding.message}
    </p>
  );
}
