import { claimJobs, completeJob, failJob, withTenantAs } from '@snap/db';
import { sql } from 'drizzle-orm';

import { chain } from './ai/router.js';
import { config } from './config.js';
import { getDb } from './db.js';
import { BedrockClaudeProvider, OllamaCloudProvider, type ExtractionProvider, type PageImage } from './extraction/provider.js';
import { runExtraction } from './extraction/run.js';
import { runShadowOcr } from './extraction/shadow.js';
import { listCapturePages, saveExtraction, saveExtractionFailure } from './repo.js';
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

const WORKER_USER = process.env.WORKER_USER_ID ?? '';

function providerFor(model: string): ExtractionProvider {
  return config().EXTRACTION_PROVIDER === 'bedrock'
    ? new BedrockClaudeProvider(model)
    : new OllamaCloudProvider(model);
}

type Job = { id: string; tenantId: string | null; payload: unknown };

async function handle(job: Job): Promise<void> {
  const payload = job.payload as { captureId?: string } | null;
  const captureId = payload?.captureId;
  if (!captureId || !job.tenantId) {
    console.error(`job ${job.id}: no captureId or tenant; skipping`);
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

  const models = chain('vision');

  // Escalation, not retry: a model that returned unparseable output at
  // temperature 0 returns the same thing again. Only a different reader
  // changes the answer.
  let lastError = 'no models tried';
  for (const spec of models) {
    const outcome = await runExtraction(providerFor(spec.id), pages);

    if (outcome.ok) {
      const { run } = outcome;
      await saveExtraction(WORKER_USER, job.tenantId, captureId, run.result, {
        model: spec.id,
        promptVersion: run.meta.promptVersion,
        latencyMs: run.meta.latencyMs,
        inputTokens: run.meta.inputTokens,
        outputTokens: run.meta.outputTokens,
        raw: run.meta.raw,
      });
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
