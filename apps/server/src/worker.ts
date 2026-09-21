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
import { OllamaCloudStatementProvider, type StatementChunkProvider } from './extraction/statement-provider.js';
import { listCapturePages, readTenant, saveExtraction, saveExtractionFailure } from './repo.js';
import { importPdfStatement } from './statements/pdf-statement-import.js';
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

/**
 * The statement-reading sibling of `providerFor` (T2, `docs/STATEMENTS.md`
 * §12 Lane T). Deliberately NOT `BedrockClaudeProvider`-branched the way
 * `providerFor` is: Bedrock is not wired up at all yet (`provider.ts`'s own
 * stub), so a statement job under `EXTRACTION_PROVIDER=bedrock` fails exactly
 * the same way a receipt job already does today — loudly, at the point the
 * call is made, not with a second silent fallback invented here.
 *
 * Constructing `OllamaCloudStatementProvider` reads the Ollama key
 * synchronously (its constructor's default parameter calls
 * `readOllamaCloudKey`, mirroring `OllamaCloudProvider`'s own
 * `readKeyFromEnvFile` default) — so a missing key fails BEFORE any chunk is
 * requested, the same "reached the provider stage" signal
 * `worker-statement-routing.test.ts` already relies on for the receipt path.
 */
function statementProviderFor(model: string): StatementChunkProvider {
  if (config().EXTRACTION_PROVIDER === 'bedrock') {
    throw new Error('bedrock-claude is not wired up yet for statement reading either — see provider.ts.');
  }
  return new OllamaCloudStatementProvider(model);
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
    const pageTexts = await readOriginalPdfText(tenantId, captureId);
    if (pageTexts === null) return null;
    return classifyExtractedText(pageTexts);
  } catch (error) {
    console.warn(
      `capture ${captureId}: could not read the original as a PDF to classify it — ` +
        `${error instanceof Error ? error.message : String(error)} — leaving it a receipt`,
    );
    return null;
  }
}

/**
 * Reads a capture's ORIGINAL upload as a PDF's per-page text, or `null` when
 * it is not a PDF at all — the shared body `classifyCapture` above was built
 * around, factored out so T2's statement-extraction branch in `handle()` can
 * call it again for the SAME capture without a second copy of the
 * "read `original_storage_key`, check the mime type, `extractPdfText`" logic.
 *
 * Calling it twice per statement job (once via `classifyCapture`, once here)
 * re-parses the same small PDF's text layer a second time — a stated,
 * accepted cost, not an oversight: this is a background job on a document
 * that has already been judged worth a model call, and re-parsing embedded
 * PDF text (no rasterisation, no network) is microseconds next to that. The
 * alternative — changing `classifyCapture`'s return shape to also hand back
 * the page texts — would touch the one function `worker-statement-routing
 * .test.ts` already asserts an exact shape for (`result?.kind`,
 * `result?.signals`), for a saving this small.
 *
 * Throws on a genuine read/parse failure (unlike `classifyCapture`, which
 * swallows the same error into `null` because "leave it a receipt" is always
 * safe there) — the statement branch has already committed to reading this
 * capture as a statement, so a failure here is reported as an extraction
 * failure, not silently downgraded.
 */
async function readOriginalPdfText(tenantId: string, captureId: string): Promise<string[] | null> {
  const original = await withTenantAs(getDb(), WORKER_USER, tenantId, async (tx) => {
    const rows = await tx.execute<{ key: string; mime: string }>(sql`
      select original_storage_key as key, original_mime_type as mime
        from captures where id = ${captureId} limit 1
    `);
    return rows.rows[0];
  });
  if (!original || original.mime !== 'application/pdf') return null;

  const bytes = readObject(original.key);
  return extractPdfText(bytes);
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
    // T2 (`docs/STATEMENTS.md` §12 Lane T): T1 stopped here and recorded a
    // `statement_classified` failure because there was nowhere to go yet.
    // There is now — `statements/pdf-statement-import.ts` runs the per-page
    // chunked reader (`extraction/statement-run.ts`) and, on success, writes
    // `documents`/`statements`/`statement_lines` directly. `saveExtraction`
    // — the receipt-shaped writer — is STILL never called on this path,
    // which is what T1's original guarantee actually protects: the receipt
    // schema never runs against a statement. A statement's own schema does.
    console.log(`job ${job.id}: capture ${captureId} classified as a statement — ${classification.reason}`);

    let pageTexts: string[];
    try {
      const texts = await readOriginalPdfText(job.tenantId, captureId);
      if (texts === null) {
        throw new Error('the original PDF could not be re-read for statement extraction after classification');
      }
      pageTexts = texts;
    } catch (error) {
      // Deliberately NOT re-thrown, unlike the "every model failed" case
      // below: this is `classifyCapture`'s own documented, structural gap
      // (the original PDF bytes were never persisted for this capture) —
      // retrying the job cannot change that outcome, so completing it here
      // (recorded, not silently dropped) is honest rather than optimistic.
      const message = error instanceof Error ? error.message : String(error);
      await saveExtractionFailure(WORKER_USER, job.tenantId, captureId, 'statement_extraction', message, 'pdf-text');
      return;
    }

    // 'chat', not 'vision': the whole cost argument (`docs/STATEMENTS.md`
    // §5.2, `statement-provider.ts`'s header) is that a native-text statement
    // needs no pixels at all — only a text-capable model, per `ai/router.ts`'s
    // capability split.
    const textModels = chain('chat');
    let lastStatementError = 'no models tried';
    for (const spec of textModels) {
      let provider: StatementChunkProvider;
      try {
        provider = statementProviderFor(spec.id);
      } catch (error) {
        // A configuration failure (no key, Bedrock not wired) — the same
        // model would fail identically on retry, so this still counts as a
        // reason to escalate to the NEXT model, exactly like a provider
        // failure caught inside `importPdfStatement` below.
        lastStatementError = `${spec.id}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`job ${job.id}: ${lastStatementError} — escalating`);
        continue;
      }

      const result = await importPdfStatement(WORKER_USER, job.tenantId, provider, { captureId, pageTexts });
      if (result.ok) {
        console.log(
          `job ${job.id}: statement ${result.statementId} → ${result.balanceCheck} (${result.lineCount} rows)`,
        );
        return;
      }

      lastStatementError = `${spec.id}: ${result.reason}`;

      // 'truncated' — the cap is ours, a stronger model hits the same
      // per-chunk cap (`run.ts`'s own reasoning, reused verbatim).
      // 'unreadable' — a business-rule refusal (no workspace, no rule set, a
      // genuine running-balance gap, an unparseable row): a DIFFERENT reading
      // model is not what fixes any of those, so retrying only spends a call
      // to reproduce the same refusal.
      if (result.stage === 'truncated' || result.stage === 'unreadable') {
        console.warn(`job ${job.id}: ${lastStatementError} — not escalating (${result.stage})`);
        break;
      }

      console.warn(`job ${job.id}: ${lastStatementError} — escalating`);
    }

    // Every model failed. Recorded the same way the receipt path's own final
    // failure is (below) — AND re-thrown, so `runOnce` releases the job with
    // backoff instead of completing it. A statement extraction failure is
    // symmetrical with a receipt one here: some causes are permanent (a
    // genuine balance gap, no rule set installed) and some are transient (a
    // provider outage), and this function cannot tell them apart any better
    // than the receipt path already admits it cannot — see `runOnce`'s own
    // comment on why a released job is safer than a swallowed error.
    await saveExtractionFailure(
      WORKER_USER,
      job.tenantId,
      captureId,
      'statement_extraction',
      lastStatementError,
      textModels.map((m) => m.id).join(','),
    );
    throw new Error(lastStatementError);
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
   * So the gate is the workspace's own country, not the presence of an id:
   * a non-AU workspace with no usable rule set for its country THROWS. `runOnce`
   * releases the thrown job with backoff (see its catch), so the capture is
   * preserved and retried when the rule set is fixed — losing the capture is
   * worse than delaying it, and validating it under the wrong law is worse
   * than either. A rule set that loads for the wrong country refuses the same
   * way: an installed `id-2026` on a workspace that has since moved to AU is
   * the same wrong-law hazard in the other direction.
   */
  const tenant = await readTenant(WORKER_USER, job.tenantId);
  if (!tenant) {
    throw new Error(`job ${job.id}: tenant ${job.tenantId} does not exist`);
  }
  let taxRules: TaxRules | null = null;
  if (tenant.tax_rules_id) {
    taxRules = await rulesFor(tenant);
    if (taxRules.country !== tenant.country) {
      throw new Error(
        `job ${job.id}: workspace country ${tenant.country} does not match its installed ` +
          `rule set ${taxRules.id} (${taxRules.country}) — refusing to validate under ` +
          `the wrong jurisdiction`,
      );
    }
  } else if (tenant.country !== 'AU') {
    throw new Error(
      `job ${job.id}: workspace country ${tenant.country} has no rule set installed — ` +
        `refusing to validate under Australian rules`,
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
