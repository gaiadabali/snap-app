import type { ExtractionFinding } from '@snap/api-contract';

import {
  buildAgreementFindings,
  latestDeviceLayoutValues,
  type DeviceValues,
} from '../extraction/agreement.js';
import type { DocumentRow } from '../repo.js';

/**
 * OD-12's read path — `docs/ON-DEVICE.md` §11 Stage 2.
 *
 * WHY THIS RUNS AT READ TIME rather than being written once by the worker.
 * `apps/server/src/extraction/agreement.ts`'s `runAgreementCheck` runs
 * immediately after extraction, but a device reading can legitimately arrive
 * AFTER that point — the mobile upload is fire-and-forget through the outbox
 * (OD-8), and §3.5 rule 4 requires the reading to never block or reorder
 * extraction. A finding computed once, post-extraction, would therefore
 * silently miss every device reading that lands even a few seconds late,
 * which in practice is most of them (upload plus recognise plus structure is
 * not instant, and extraction itself may finish first for a small photo).
 *
 * So the comparison this file does is the one that actually reaches
 * `DocumentView.findings`: computed fresh on every `GET`, from whatever the
 * latest device layout says right now against the document's OWN current
 * field values — which is also correct after a human correction, where the
 * worker's one-off snapshot against the model's raw extraction would go
 * stale.
 *
 * ADDITIVE, per the ticket's file-ownership note: this only ever appends
 * `severity: 'note'` findings onto whatever `toWire` already produced from
 * `documents.ato_compliance.findings` (the deterministic validators in
 * `extraction/validators.ts`). It never removes, reorders or mutates an
 * existing finding, and it never writes anything back to `documents` — same
 * shadow discipline as `runAgreementCheck`, just at the other end of time.
 */

function documentValues(document: Pick<
  DocumentRow,
  'supplier_name' | 'supplier_abn' | 'issue_date' | 'payable_amount' | 'tax_amount'
>): DeviceValues {
  return {
    'header.supplier': document.supplier_name,
    'header.supplier_abn': document.supplier_abn,
    'header.issue_date': document.issue_date,
    'header.payable_amount': document.payable_amount,
    'header.tax_amount': document.tax_amount,
  };
}

/**
 * The agreement findings for one document, or `[]` when there is no device
 * reading to compare against yet — never an error the caller has to handle,
 * matching every other shadow-style call in this codebase.
 */
export async function deviceAgreementFindings(
  userId: string,
  tenantId: string,
  document: Pick<
    DocumentRow,
    'capture_id' | 'supplier_name' | 'supplier_abn' | 'issue_date' | 'payable_amount' | 'tax_amount'
  >,
): Promise<ExtractionFinding[]> {
  try {
    const device = await latestDeviceLayoutValues(userId, tenantId, document.capture_id);
    if (!device) return [];
    return buildAgreementFindings(device.values, documentValues(document));
  } catch (error) {
    // Read-path failures must never break opening a document over an advisory
    // signal. One line, same discipline as the worker's own catch.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`document for capture ${document.capture_id}: device agreement read failed — ${message}`);
    return [];
  }
}
