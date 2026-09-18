import { withTenantAs, type Tx } from '@snap/db';
import type { ExtractionFinding } from '@snap/api-contract';
import {
  PREVIEW_FIELDS,
  normalisedOrNull,
  sameValue,
  toIsoDate,
  type PreviewPath,
} from '@snap/docai-preview';
import { sql } from 'drizzle-orm';

import { getDb } from '../db.js';
import { groundingForLayout } from '../repo.js';
import type { Extraction } from './types.js';

/**
 * Device-vs-server agreement — `docs/ON-DEVICE.md` OD-12.
 *
 * THE RULE THIS FOLLOWS: exactly like `shadow.ts`, this is advisory
 * evidence-gathering that must never affect the extraction result that has
 * already been saved by the time it runs. It never throws out of its own
 * public functions, it writes nothing to `documents`, `extraction_runs` or
 * `review_tasks`, and an error here is one logged line, never a failed job.
 *
 * THE COMPARISON RULES ARE NOT RESTATED HERE. `docs/ON-DEVICE.md`'s ticket for
 * this work is explicit that a second comparator is a second set of rules to
 * keep honest — `PREVIEW_FIELDS`, `meaningful()`/`normalisedOrNull()` and
 * `sameValue()` moved out of `apps/mobile/src/lib/provisional.ts` into
 * `@snap/docai-preview`'s `agreement.ts` for exactly this reuse. This file
 * only supplies what that module cannot know: how to reach a capture's device
 * values (`latestDeviceLayoutValues`) and, for the date field only, how to put
 * a raw device string into the same ISO form an `Extraction.issueDate` is
 * always already in (`toIsoDate`, from the SAME structurer package — not a
 * second parser).
 *
 * WHY A SEPARATE DATE STEP. The device-reading intake
 * (`apps/server/src/captures/device-reading.controller.ts`) stores the
 * structurer's raw `value` for `header.issue_date` in
 * `document_field_grounding`, not its ISO `normalisedValue` — the DTO there
 * has no field for it. `sameValue()` deliberately does not parse dates itself
 * (see its own comment), so this file runs the raw device string through
 * `toIsoDate` before handing both sides to `sameValue()`. That is supplying
 * ISO input, not a second comparison rule.
 */

/** Only these two engine ids may describe a device reading (§3.3, §3.5). */
const DEVICE_ENGINE_IDS = ['device-vision', 'device-mlkit'] as const;

export type DeviceValues = Partial<Record<PreviewPath, string | null>>;

export type DeviceLayoutInfo = {
  layoutId: string;
  /** e.g. `['device-vision']`. Empty only if the row is malformed. */
  engineIds: string[];
  /** `{platform, osVersion, model, totalMemoryMb}` per migration 0028; `{}` if never reported. */
  deviceMeta: Record<string, unknown>;
  values: DeviceValues;
};

/**
 * The five header fields this comparison covers, pulled out of the model's
 * own extraction — the same fields, and the same "read the model's raw
 * output, never the merged `documents`/`parties` row" discipline, as
 * `shadow.ts`'s `fieldsToGround`. `issueDate.value` is already ISO
 * (`extraction/types.ts`'s own comment).
 */
export function extractionValues(extraction: Extraction): DeviceValues {
  return {
    'header.supplier': extraction.supplierName.value,
    'header.supplier_abn': extraction.supplierAbn.value,
    'header.issue_date': extraction.issueDate.value,
    'header.payable_amount': extraction.payableAmount.value,
    'header.tax_amount': extraction.taxAmount.value,
  };
}

/**
 * Finds the most recent DEVICE layout for a capture (there may also be a
 * server-side shadow OCR layout on the same capture — `shadow.ts`'s own — and
 * this must not pick that one up) and its grounding rows, reduced to one
 * value per field path.
 *
 * Read-only; safe to call from the worker's post-extraction hook and from the
 * documents read path alike. `null` when no device reading has arrived yet —
 * a document can exist before one does (§3.5 rule 4: the reading never blocks
 * or reorders extraction), and that is not an error.
 */
export async function latestDeviceLayoutValues(
  userId: string,
  tenantId: string,
  captureId: string,
): Promise<DeviceLayoutInfo | null> {
  const row = await withTenantAs(getDb(), userId, tenantId, async (tx: Tx) => {
    const rows = await tx.execute<{
      id: string;
      engine_ids: string[];
      device_meta: Record<string, unknown> | null;
    }>(sql`
      select id, engine_ids, device_meta
        from document_layouts
       where capture_id = ${captureId}
         and engine_ids && array[${sql.join(
           DEVICE_ENGINE_IDS.map((e) => sql`${e}`),
           sql`, `,
         )}]::text[]
       order by created_at desc
       limit 1
    `);
    return rows.rows[0] ?? null;
  });
  if (!row) return null;

  const grounding = await groundingForLayout(userId, tenantId, row.id);
  const values: DeviceValues = {};
  for (const g of grounding) {
    if ((PREVIEW_FIELDS as Record<string, string | undefined>)[g.fieldPath]) {
      values[g.fieldPath as PreviewPath] = g.value;
    }
  }

  return {
    layoutId: row.id,
    engineIds: row.engine_ids ?? [],
    deviceMeta: row.device_meta ?? {},
    values,
  };
}

/**
 * Pure comparison — no I/O, easy to pin with a fixture. Emits one
 * `severity: 'note'` finding per field where BOTH sides answered and
 * disagree; a field where either side is silent is skipped (silence is not a
 * disagreement, §7.1's "suggestion"/"server-only" rows), and a field where
 * both agree is skipped because there is nothing to say. The message names
 * both values, per OD-12's "done when": a forced disagreement must carry both.
 */
export function buildAgreementFindings(
  device: DeviceValues,
  extraction: DeviceValues,
): ExtractionFinding[] {
  const findings: ExtractionFinding[] = [];
  for (const path of Object.keys(PREVIEW_FIELDS) as PreviewPath[]) {
    let deviceValue = normalisedOrNull(device[path] ?? null);
    let otherValue = normalisedOrNull(extraction[path] ?? null);
    if (path === 'header.issue_date') {
      deviceValue = deviceValue === null ? null : toIsoDate(deviceValue);
      otherValue = otherValue === null ? null : toIsoDate(otherValue);
    }
    if (deviceValue === null || otherValue === null) continue;
    if (sameValue(path, deviceValue, otherValue)) continue;

    findings.push({
      code: 'device_agreement_diff',
      severity: 'note',
      field: PREVIEW_FIELDS[path],
      message: `Device read ${deviceValue}; server read ${otherValue} for ${PREVIEW_FIELDS[path]}.`,
    });
  }
  return findings;
}

/**
 * The worker's post-extraction hook — called from `worker.ts` right after
 * `runShadowOcr`, same place, same discipline: never throws, one line logged
 * on both success and failure, and it writes nothing. `documents` is not
 * updated here; `apps/server/src/documents/device-agreement.ts` recomputes
 * the same comparison at READ time instead (see that file's header for why:
 * a device reading can legitimately arrive after this job has already run,
 * since §3.5 rule 4 says it must never block or reorder extraction — a
 * snapshot taken here would silently miss every reading that lands later).
 * This hook exists to (a) do the ticket's literal "the worker compares..."
 * step and (b) log an immediate signal when the reading already happened to
 * be in before extraction finished.
 */
export async function runAgreementCheck(
  workerUserId: string,
  tenantId: string,
  captureId: string,
  extraction: Extraction,
): Promise<void> {
  try {
    const device = await latestDeviceLayoutValues(workerUserId, tenantId, captureId);
    if (!device) return; // nothing to shadow-compare against yet — not a failure.

    const findings = buildAgreementFindings(device.values, extractionValues(extraction));
    const compared = Object.keys(PREVIEW_FIELDS).filter(
      (p) => device.values[p as PreviewPath] != null,
    ).length;
    console.log(
      `capture ${captureId}: device agreement — ${compared - findings.length}/${compared} fields agree` +
        ` (engine ${device.engineIds.join(',') || 'unknown'}, device ${
          (device.deviceMeta as { model?: string }).model ?? 'unknown'
        })`,
    );
  } catch (error) {
    // One line, on failure, and nothing else — the extraction result this job
    // already saved is untouched. Same discipline as `shadow.ts`'s outer catch.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`capture ${captureId}: device agreement check failed — ${message}`);
  }
}
