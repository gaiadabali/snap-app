import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Client } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { chain } from "./ai/router.js";
import { usdToAudMicros } from "./extraction/call-cost.js";
import { provisionTenant, wipeTenant } from "./test-support/tenant.js";

/**
 * Group plan 7.2 and 7.3: every model call is recorded with what it cost, and a
 * retried job tries only the first model. Real Postgres as the real worker
 * role; OpenRouter is a stubbed `fetch` that reports `usage.cost`.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = "c5e50000-0000-4000-8000-0000000000c1";
const WORKER_USER_ID = "c5e50000-0000-4000-8000-0000000000c2";
const USER = "c5e50000-0000-4000-8000-0000000000c3";

const RECEIPT_JSON = JSON.stringify({
  docType: { value: "receipt", confidence: 0.95 },
  issueDate: { value: "2026-09-10", confidence: 0.95 },
  currency: { value: "AUD", confidence: 0.95 },
  supplierName: { value: "Ampol Riverside", confidence: 0.95 },
  payableAmount: { value: "84.20", confidence: 0.95 },
  taxAmount: { value: "7.65", confidence: 0.95 },
  lines: [],
  notes: { legible: true },
});

const reply = (content: string, cost: number) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1500, completion_tokens: 300, cost },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describeIfDb("worker: what each run cost (7.2) and retries (7.3.b)", () => {
  let admin: Client;
  let storageRoot: string;
  let worker: typeof import("./worker.js");
  let put: typeof import("./storage.js").put;
  let enqueueExtraction: typeof import("./repo.js").enqueueExtraction;
  let closeDb: typeof import("./db.js").closeDb;

  const savedEnv: Record<string, string | undefined> = {};
  const setEnv = (k: string, v: string | undefined) => {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };

  beforeAll(async () => {
    storageRoot = mkdtempSync(join(tmpdir(), "run-cost-worker-"));
    setEnv("STORAGE_DIR", storageRoot);
    setEnv(
      "TOKEN_SECRET",
      process.env.TOKEN_SECRET ??
        "test-only-secret-at-least-32-characters-long",
    );
    setEnv("WORKER_USER_ID", WORKER_USER_ID);
    setEnv(
      "WORKER_DATABASE_URL",
      (process.env.DATABASE_URL ?? "").replace(
        /:\/\/[^:]+:/,
        "://snap_worker:",
      ),
    );
    setEnv("EXTRACTION_PROVIDER", "openrouter");
    setEnv("OPENROUTER_API_KEY", "sk-or-test");
    setEnv("DOCAI_SIDECAR_URL", undefined);

    admin = await provisionTenant({
      tenantId: TENANT,
      name: "Run cost worker co",
      scanCredits: 100,
      users: [
        {
          id: USER,
          role: "owner",
          subject: "test|cost-user",
          email: "user@run-cost.test",
        },
      ],
      serviceUsers: [
        {
          id: WORKER_USER_ID,
          subject: "test|cost-worker",
          email: "worker@run-cost.test",
        },
      ],
    });

    const dbModule = await import("./db.js");
    closeDb = dbModule.closeDb;
    dbModule.useWorkerConnection();
    put = (await import("./storage.js")).put;
    enqueueExtraction = (await import("./repo.js")).enqueueExtraction;
    worker = await import("./worker.js");
  });

  beforeEach(async () => {
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await closeDb();
    await admin.query(`delete from jobs where tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [WORKER_USER_ID, USER]);
    await admin.end();
    rmSync(storageRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function queuedCapture(): Promise<string> {
    const { key, byteSize } = put(
      TENANT,
      Buffer.from(`a photographed receipt ${randomUUID()}`),
    );
    const id = randomUUID();
    await admin.query(
      `insert into captures (id, tenant_id, uploaded_by, original_storage_key, original_mime_type,
                             original_byte_size, original_sha256, status)
       values ($1, $2, $3, $4, 'image/jpeg', $5, decode($6, 'hex'), 'received')`,
      [
        id,
        TENANT,
        USER,
        key,
        byteSize,
        randomUUID().replace(/-/g, "").repeat(2),
      ],
    );
    await enqueueExtraction(USER, TENANT, id);
    return id;
  }

  const runs = async (captureId: string) =>
    (
      await admin.query(
        `select model_id, status, cost_micros::int as cost, input_tokens, error
           from extraction_runs where capture_id = $1 order by created_at, id`,
        [captureId],
      )
    ).rows;

  it("stores the reported charge of a scan that read first time, in AUD", async () => {
    const bodies: Array<Record<string, any>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return reply(RECEIPT_JSON, 0.00035);
      }),
    );
    const captureId = await queuedCapture();
    await worker.runOnce(1);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.provider.max_price).toBeDefined();
    expect(await runs(captureId)).toMatchObject([
      {
        model_id: "gemma4:31b",
        status: "succeeded",
        cost: usdToAudMicros(0.00035),
        input_tokens: 1500,
      },
    ]);
  });

  it("records the failed call of an earlier model, with its charge, next to the one that read", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++n === 1
          ? reply("not json at all", 0.0004)
          : reply(RECEIPT_JSON, 0.002),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const captureId = await queuedCapture();
    await worker.runOnce(1);

    const rows = await runs(captureId);
    expect(rows.map((r) => [r.status, r.cost])).toEqual(
      expect.arrayContaining([
        ["failed", usdToAudMicros(0.0004)],
        ["succeeded", usdToAudMicros(0.002)],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.status === "failed")!.error).toMatch(/No JSON/);
    vi.restoreAllMocks();
  });

  it("records one failed run per model when every model fails, and a retry tries only the first", async () => {
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        models.push(JSON.parse(init.body as string).model);
        return reply("not json at all", 0.001);
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const captureId = await queuedCapture();

    await worker.runOnce(1);
    expect(models).toHaveLength(4);
    const first = await runs(captureId);
    expect(first).toHaveLength(4);
    expect(
      first.every(
        (r) => r.status === "failed" && r.cost === usdToAudMicros(0.001),
      ),
    ).toBe(true);
    // One name per model: the registry id, the same form the succeeded rows use.
    expect(first.map((r) => r.model_id).sort()).toEqual(
      chain("vision")
        .map((m) => m.id)
        .sort(),
    );

    // The queue backs a failed job off; make it due, then let it retry.
    await admin.query(
      `update jobs set run_after = now() where tenant_id = $1 and kind = 'extract'`,
      [TENANT],
    );
    models.length = 0;
    await worker.runOnce(1);
    expect(models).toEqual(["google/gemma-4-31b-it"]);
    expect(await runs(captureId)).toHaveLength(5);
    vi.restoreAllMocks();
  });

  it("groups a model's failed and succeeded runs under one name, as the admin per-model table does", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ++n <= 4 ? reply("not json at all", 0.001) : reply(RECEIPT_JSON, 0.002),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const captureId = await queuedCapture();
    await worker.runOnce(1); // every model fails
    await admin.query(
      `update jobs set run_after = now() where tenant_id = $1 and kind = 'extract'`,
      [TENANT],
    );
    await worker.runOnce(1); // the retry asks the first model, which reads it

    const groups = (
      await admin.query(
        `select model_id, count(*)::int as runs,
                count(*) filter (where status = 'failed')::int as failed
           from extraction_runs where capture_id = $1 group by model_id`,
        [captureId],
      )
    ).rows;
    const gemma = groups.find((g) => g.model_id === "gemma4:31b");
    expect(gemma).toMatchObject({ runs: 2, failed: 1 });
    expect(groups.map((g) => g.model_id).sort()).toEqual(
      chain("vision")
        .map((m) => m.id)
        .sort(),
    );
    vi.restoreAllMocks();
  });

  it("resumes a walk cut short: a retry tries the models that have not failed yet, not just the first", async () => {
    // As if the worker was killed after gemma failed, mid-minimax.
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        models.push(JSON.parse(init.body as string).model);
        return reply(RECEIPT_JSON, 0.002);
      }),
    );
    const captureId = await queuedCapture();
    await admin.query(
      `insert into extraction_runs (id, tenant_id, capture_id, engine, model_id, prompt_version,
                                    schema_version, tier, status, error, started_at, finished_at)
       values (gen_random_uuid(), $1, $2, 'ocr_llm', 'gemma4:31b', 'n/a', '1', 1, 'failed',
               'provider: gemma4:31b: No JSON', now(), now())`,
      [TENANT, captureId],
    );
    await admin.query(
      `update jobs set attempts = 1 where tenant_id = $1 and kind = 'extract'`,
      [TENANT],
    ); // the claim makes it attempt 2
    await worker.runOnce(1);

    expect(models).toEqual(["minimax/minimax-m3"]);
    const docs = await admin.query(
      `select 1 from documents where capture_id = $1`,
      [captureId],
    );
    expect(docs.rowCount).toBe(1);
  });

  it("records a statement chunk call per row, each with its charge, and the failed one with its reason", async () => {
    const captureId = await queuedCapture();
    const calls = [
      {
        model: "z-ai/glm-5.3",
        costMicros: 400,
        inputTokens: 900,
        outputTokens: 200,
        latencyMs: 800,
        error: null,
      },
      {
        model: "z-ai/glm-5.3",
        costMicros: 450,
        inputTokens: 950,
        outputTokens: 210,
        latencyMs: 900,
        error: null,
      },
      {
        model: "z-ai/glm-5.3",
        costMicros: 500,
        inputTokens: 980,
        outputTokens: 4000,
        latencyMs: 9000,
        error: "hit the cap",
      },
    ];
    await worker.recordCalls(
      TENANT,
      captureId,
      { model: "z-ai/glm-5.3", modelCalls: calls },
      "stmt-v1",
      {
        stage: "statement_extraction",
        error: "glm-5.3: hit the cap",
      },
    );

    const rows = await runs(captureId);
    // Written in one transaction, so created_at ties; order by cost.
    expect(
      rows.map((r) => [r.status, r.cost]).sort((a, b) => a[1] - b[1]),
    ).toEqual([
      ["succeeded", 400],
      ["succeeded", 450],
      ["failed", 500],
    ]);
    expect(rows[2]!.error).toMatch(
      /statement_extraction: glm-5.3: hit the cap/,
    );
  });
});
