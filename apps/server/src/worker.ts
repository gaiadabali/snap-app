import { claimJobs, completeJob, failJob, withTenantAs } from '@snap/db';
import type { TaxRules } from '@snap/tax-rules';
import { sql } from 'drizzle-orm';

import { chain } from './ai/router.js';
import { config } from './config.js';
import { getDb } from './db.js';
import { runAgreementCheck } from './extraction/agreement.js';
import { classifyExtractedText, type Classification } from './extraction/classify.js';
import { extractPdfText } from './extraction/pdf.js';
import { BedrockClaudeProvider, OllamaCloudProvider, type ExtractionProvider, type PageImage } from './extraction/provider.js';
import { extractionPromptFor } from './extraction/prompt.js';
import { runExtraction } from './extraction/run.js';
import { runShadowOcr } from './extraction/shadow.js';
import { listCapturePages, readTenant, saveExtraction, saveExtractionFailure } from './repo.js';
import { rulesFor } from './taxrules/taxrules.repo.js';
import { get as readObject } from './storage.js';

/**
 * The extraction worker.
 *
 * A separate process from the API on purpose. A model call takes two to twenty
 * seconds; doing it inside an HTTP request would hold a connection open for
 * the duration and time out on the sort of connection a driver has at a truck
 * stop. The queue also means a provider outage delays extraction rather than
 * losing a capture — the image is already stored, which is the part that
 * cannot be recreated.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so running several workers is the
 * scaling story: they never block on each other and never take the same job.
 */

/**
 * The identity this worker acts as. REFUSES rather than defaulting.
 *
 * This was `process.env.WORKER_USER_ID ?? ''`, and that empty string cost this
 * project every extraction it ever attempted in production. The variable was
 * absent from `deploy/.env`, so every `withTenantAs(db, '', tenant, ...)` threw
 * `not a uuid: ""` — a message that points at a database helper, three layers
 * below a missing line of configuration.
 *
 * Nothing caught it. The worker started, reported `worker up`, claimed jobs and
 * failed each one; captures piled up at `received` from 2026-09-16 to
 * 2026-09-18 and `documents` stayed empty. From the phone it looked like a slow
 * server. The only reason anybody found it is that somebody scanned a receipt
 * and said the app was stuck.
 *
 * A misconfiguration must fail at BOOT, loudly, naming the variable — not turn
 * into a runtime error that reads like a bug in someone's code. That is the
 * same rule `provider.ts` follows for the API key and the tax-rules registry
 * follows for a missing rule set: no fallback, and the refusal carries the
 * reason.
 */
const WORKER_USER = requireWorkerUser();

function requireWorkerUser(): string {
  const raw = (process.env.WORKER_USER_ID ?? '').trim();
  if (!raw) {
    throw new Error(
      'WORKER_USER_ID is not set. The extraction worker has no identity to act as, so every ' +
        'job would fail with `withTenantAs: not a uuid: ""` — which reads like a database bug ' +
        'and is not one. Set it to the service user (worker@snapapps.internal) in deploy/.env. ' +
        'This refusal exists because the empty-string default silently broke every extraction ' +
        'in production for days.',
    );
  }
  // A non-uuid would fail identically but later, inside a transaction, per job.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    throw new Error(`WORKER_USER_ID is not a uuid: ${JSON.stringify(raw)}`);
  }
  return raw;
}

function providerFor(model: string, rules: TaxRules | null): ExtractionProvider {
  // The prompt is part of the jurisdiction, not a constant. A workspace with
  // no rule set gets the Australian prompt, which is what it has always got.
  const prompt = rules
    ? extractionPromptFor({
        countryName: rules.countryName,
        consumptionTax: {
          name: rules.consumptionTax.name,
          // The EFFECTIVE rate — statutory x base fraction. Indonesia prints
          // 12% and charges 11%, and the model should be told the 11%.
          statutoryRate: {
            n: rules.consumptionTax.statutoryRate.n * rules.consumptionTax.baseFraction.n,
            d: rules.consumptionTax.statutoryRate.d * rules.consumptionTax.baseFraction.d,
          },
        },
        taxId: rules.taxId,
        currency: rules.currency,
        documentRules: rules.documentRules,
        otherTaxes: rules.otherTaxes,
        consumptionTaxExemptHints: rules.consumptionTax.exemptCategories.flatMap((c) => c.hints),
      })
    : undefined;

  return config().EXTRACTION_PROVIDER === 'bedrock'
    ? new BedrockClaudeProvider(model)
    : new OllamaCloudProvider(model, undefined, undefined, prompt);
}

type Job = { id: string; tenantId: string | null; payload: unknown };

/**
 * T1 (`docs/STATEMENTS.md` §12 Lane T): classifies a capture as a statement or
 * a receipt from its OWN native PDF text, BEFORE `providerFor`/`runExtraction`
 * ever run — see `extraction/classify.ts`'s header for the signal itself and
 * why it is trustworthy. Returns `null` for "no opinion, leave it a receipt",
 * which is the same outcome `classifyExtractedText` already returns for a
 * document with too few signals — this function adds exactly one more reason
 * to land there: not being a PDF at all, or the PDF not being readable.
 *
 * Reads `captures.original_storage_key` directly rather than through
 * `capture_pages`, because `capture_pages` holds only RASTERISED bytes —
 * `pdf.ts`'s `DemuxedPage` never carries a page's text back out of `demuxPdf`
 * — so the original upload is the only place a real text layer can still be
 * read from. That is also this function's one known limitation, reported
 * rather than hidden: `captures.controller.ts`'s `upload()` never persists
 * the RAW PDF bytes for a capture that gets demuxed into `capture_pages` rows
 * (only the rendered PNG pages are written to storage), so for a capture
 * uploaded through today's multi-page intake path, `readObject` below throws
 * ENOENT and this function falls through to its own catch — safely, but
 * silently, to 'receipt'. It classifies correctly today for every capture
 * whose `original_storage_key` genuinely holds the original file (pre-0018
 * single-page captures, and any fixture or future intake path that persists
 * it) and is a no-op-safe default everywhere else. Persisting the raw PDF (or
 * its extracted text) at intake is `captures.controller.ts`/schema work
 * outside this ticket's file list — flagged as a follow-up, not fixed here.
 *
 * Exported for direct testing — `worker-statement-routing.test.ts` covers
 * both this function in isolation and the end-to-end fork through `runOnce`.
 */
export async function classifyCapture(tenantId: string, captureId: string): Promise<Classification | null> {
  try {
    const original = await withTenantAs(getDb(), WORKER_USER, tenantId, async (tx) => {
      const rows = await tx.execute<{ key: string; mime: string }>(sql`
        select original_storage_key as key, original_mime_type as mime
          from captures where id = ${captureId} limit 1
      `);
      return rows.rows[0];
    });
    if (!original || original.mime !== 'application/pdf') return null;

    const bytes = readObject(original.key);
    const pageTexts = await extractPdfText(bytes);
    return classifyExtractedText(pageTexts);
  } catch (error) {
    console.warn(
      `capture ${captureId}: could not read the original as a PDF to classify it — ` +
        `${error instanceof Error ? error.message : String(error)} — leaving it a receipt`,
    );
    return null;
  }
}

async function handle(job: Job): Promise<void> {
  const payload = job.payload as { captureId?: string } | null;
  const captureId = payload?.captureId;
  if (!captureId || !job.tenantId) {
    console.error(`job ${job.id}: no captureId or tenant; skipping`);
    return;
  }

  const classification = await classifyCapture(job.tenantId, captureId);
  if (classification?.kind === 'statement') {
    // T2 (`statement-schema.json` and the per-page statement extraction path)
    // does not exist yet — recorded and stopped here rather than falling
    // through into the receipt-shaped reader, which would read a closing
    // balance as a payable total (`docs/STATEMENTS.md` §2). Reuses the same
    // `extraction_runs` write the provider-failure path already makes: there
    // is no 'skipped' member of `run_status` (`packages/db/src/schema/
    // enums.ts` — queued/running/succeeded/failed/superseded), and adding one
    // is a schema decision outside this ticket's file list. `saveExtraction`
    // — the only writer of a `documents` row — is never called on this path,
    // which is the actual guarantee T1 asks for: the receipt schema never
    // runs against a statement.
    console.log(`job ${job.id}: capture ${captureId} classified as a statement — ${classification.reason}`);
    await saveExtractionFailure(
      WORKER_USER,
      job.tenantId,
      captureId,
      'statement_classified',
      classification.reason,
      'text-classifier',
    );
    return;
  }

  // Every stored page, in page order. Never a normalised derivative: the
  // model reads what the ATO would accept as the record.
  //
  // Read with the worker's own membership, not as a superuser: the worker is
  // an ordinary member of the workspace (see scripts/seed.ts) and goes through
  // the same row-level security as everyone else. A background job with a
  // bypass is a background job nobody audits.
  const pageRows = await listCapturePages(WORKER_USER, job.tenantId, captureId);

  let pages: PageImage[];
  if (pageRows.length > 0) {
    pages = pageRows.map((p) => ({ bytes: readObject(p.storage_key), mimeType: p.mime_type }));
  } else {
    // No `capture_pages` rows: either this capture predates them, or
    // something upstream skipped recording one. Falling back to the
    // single-file original rather than failing the job keeps every capture
    // made before this change extractable exactly as it always was.
    const capture = await withTenantAs(getDb(), WORKER_USER, job.tenantId, async (tx) => {
      const rows = await tx.execute<{ key: string; mime: string }>(sql`
        select original_storage_key as key, original_mime_type as mime
          from captures where id = ${captureId} limit 1
      `);
      return rows.rows[0];
    });
    if (!capture) {
      console.error(`job ${job.id}: capture ${captureId} is gone`);
      return;
    }
    pages = [{ bytes: readObject(capture.key), mimeType: capture.mime }];
  }

  /**
   * The workspace's tax rule set, resolved once for this job.
   *
   * `null` means no engine installed, which is every Australian workspace and
   * is the documented pre-0026 state — `validate()` then behaves exactly as it
   * always has. What must NOT happen is an Indonesian workspace silently
   * getting that same path: a receipt read under Australian rules produces a
   * GST arithmetic complaint on every PPN line, demands an ABN that does not
   * exist, and calls a rupiah total a dollar figure.
   *
   * A rule set that fails to load is left null rather than failing the job. The
   * document still gets read and stored — losing the capture would be worse
   * than validating it conservatively — and the findings a reviewer sees are
   * the Australian ones, which is visibly wrong rather than quietly wrong.
   */
  let taxRules: TaxRules | null = null;
  try {
    const tenant = await readTenant(WORKER_USER, job.tenantId);
    if (tenant?.tax_rules_id) taxRules = await rulesFor(tenant);
  } catch (error) {
    console.error(
      `job ${job.id}: tax rules did not load for tenant ${job.tenantId}; ` +
        `validating without a rule set — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const models = chain('vision');

  // Escalation, not retry: a model that returned unparseable output at
  // temperature 0 returns the same thing again. Only a different reader
  // changes the answer.
  let lastError = 'no models tried';
  for (const spec of models) {
    const outcome = await runExtraction(providerFor(spec.id, taxRules), pages, new Date(), taxRules);

    if (outcome.ok) {
      const { run } = outcome;
      await saveExtraction(
        WORKER_USER,
        job.tenantId,
        captureId,
        run.result,
        {
          model: spec.id,
          promptVersion: run.meta.promptVersion,
          latencyMs: run.meta.latencyMs,
          inputTokens: run.meta.inputTokens,
          outputTokens: run.meta.outputTokens,
          raw: run.meta.raw,
        },
        // The same rule set (or null) just resolved above for `validate()` —
        // the per-category tax split this writes must agree with the law the
        // extraction was validated under.
        taxRules,
      );
      console.log(
        `job ${job.id}: ${spec.id} → ${run.result.reviewStatus}` +
          ` (${run.result.findings.length} findings, ${run.meta.latencyMs} ms)`,
      );

      // Phase 1b, shadow only (docs/contracts/phase1b-shadow-stage.md §3):
      // runs the OCR stage over the same `capture_pages` just read above and
      // records what it produced, then grounds the model's own extraction
      // fields against it (docs/contracts/phase1c-grounding.md §3). Passed as
      // `run.result.extraction` — the model's raw output — and NOT re-read
      // from `documents`/`parties` afterwards: see `shadow.ts`'s
      // `fieldsToGround` for why that distinction matters. Awaited so a
      // short-lived `runOnce` process does not exit mid-attempt, but it is
      // its own safety boundary — see `shadow.ts`'s header — so it can never
      // fail this job or touch the extraction result just saved. A no-op,
      // with zero cost beyond the config read, whenever `DOCAI_SIDECAR_URL`
      // is unset.
      await runShadowOcr(WORKER_USER, job.tenantId, captureId, run.result.extraction, pageRows);

      // OD-12 (docs/ON-DEVICE.md §11 Stage 2): compares whatever device
      // reading has already arrived for this capture against the model's own
      // extraction and logs the agreement, shadow-style — never throws,
      // writes nothing. See `agreement.ts`'s header for why the finding shown
      // to a user is recomputed at read time instead of persisted here.
      await runAgreementCheck(WORKER_USER, job.tenantId, captureId, run.result.extraction);
      return;
    }

    lastError = `${spec.id}: ${outcome.failure.error}`;

    // Truncation ends the walk. Escalating spends a model call to reproduce
    // our own output cap, three more times, and the last one is the most
    // expensive model in the registry.
    if (outcome.failure.stage === 'truncated') {
      console.warn(`job ${job.id}: ${lastError} — not escalating, the cap is ours`);
      break;
    }

    console.warn(`job ${job.id}: ${lastError} — escalating`);
  }

  // Every model failed. Recorded against the capture so the next attempt, or
  // a person, can see what happened rather than finding a silent gap.
  await saveExtractionFailure(
    WORKER_USER,
    job.tenantId,
    captureId,
    'provider',
    lastError,
    models.map((m) => m.id).join(','),
  );
  throw new Error(lastError);
}

export async function runOnce(limit = 1): Promise<number> {
  const jobs = await claimJobs(getDb(), 'extract', `worker-${process.pid}`, limit);
  for (const job of jobs) {
    try {
      await handle(job);
      // Claiming is not completing. A job left claimed is a job that either
      // never runs again or runs twice, depending on the lock timeout.
      await completeJob(getDb(), job.id);
    } catch (error) {
      // Released with backoff rather than swallowed: a provider outage should
      // delay a capture, never lose it. The image is already stored.
      const message = error instanceof Error ? error.message : String(error);
      await failJob(getDb(), job.id, message);
      // Recorded, then the batch CONTINUES. Rethrowing here abandoned every
      // other job already claimed in the same batch — they stayed locked with
      // nothing to complete them, which is exactly the hazard the comment
      // above warns about. One unreadable object used to take down the whole
      // drain; found by a stale queue entry whose file no longer existed.
      console.error(`job ${job.id} failed: ${message}`);
    }
  }
  return jobs.length;
}

/** Polls until stopped. Long enough between empty polls not to spin. */
export async function runForever(intervalMs = 2000): Promise<void> {
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`${signal} — finishing the current job then stopping`);
      stopping = true;
    });
  }

  console.log(`worker up · provider ${config().EXTRACTION_PROVIDER}`);
  while (!stopping) {
    try {
      const done = await runOnce(1);
      if (done === 0) await new Promise((r) => setTimeout(r, intervalMs));
    } catch (error) {
      // A failed job is already recorded; the loop must not die with it.
      console.error('job failed:', error instanceof Error ? error.message : error);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
