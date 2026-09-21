/**
 * The TIER 1 engine: lane E's Python sidecar (`services/docai-engine`),
 * wrapping PP-OCRv5 behind the HTTP seam docs/contracts/phase1-ocr-stage.md
 * §4 specifies:
 *
 *   POST /read   multipart: image bytes + JSON { pageNumber, capabilities, region? }
 *                → 200 { blocks, unreadable, engine, timings }
 *   GET  /health → { ok, models: [{ id, licence, loaded }], device }
 *
 * §3 of that contract is the reason this file exists at all: everything that
 * makes detection and recognition good lives in the Python CV ecosystem, so
 * TypeScript keeps the pipeline and calls out to it over a process boundary
 * — the reason `Engine.read` in registry.ts is `async` in the first place,
 * before anyone here knew a sidecar was coming.
 *
 * Lane E may still be mid-build when this lands (`services/docai-engine` had
 * only install smoke tests as of this writing, no server yet) — this adapter
 * is written against the DOCUMENTED endpoints and tested against a fake HTTP
 * server standing in for one, never against a live sidecar. See
 * `sidecar.test.ts` for what that does and does not prove.
 *
 * ## Why `requiresNetwork: false` is correct, not a typo
 *
 * `registry.ts`'s `permitted()` reads `requiresNetwork` to decide whether an
 * engine may run under the `air-gapped` profile, and an air-gapped install by
 * definition has no network to send a document over. It looks wrong for an
 * HTTP client to claim it: this file quite literally calls `fetch`.
 *
 * But `requiresNetwork` is standing in for a narrower question than its name
 * suggests — "does reaching this engine require the document to leave the
 * machine" — and a loopback call to a sidecar process running on the SAME
 * host never does. `residency: 'self-hosted'` already says where the model
 * runs; `requiresNetwork: false` says the boundary it runs behind is a
 * process boundary, not an egress boundary. Marking this `true` would be the
 * actually wrong answer: it would make `permitted()` strip the one engine an
 * air-gapped, CPU-only deployment needs for anything past tier 0, for a
 * document that in truth never left the box.
 */

import type { Block, Document } from '../docdom.js';
import type { Capability, Engine, EngineSpec, PageInput, WeightsLicence } from '../registry.js';
import { violatesLicenceFloor } from '../registry.js';

export type SidecarConfig = {
  /**
   * Which generation the sidecar is running — `ppocr-v5` (default) or
   * `ppocr-v6`. Must match its `DOCAI_MODEL_TIER`; `health()` reports what it
   * actually loaded.
   */
  engineId?: string;
  /**
   * Loopback by construction — see the file header. Overridable (env var,
   * test harness) but the default is deliberately `127.0.0.1`, never a
   * hostname that could resolve off-box.
   */
  baseUrl?: string;
  /** Per-attempt timeout. A page that legitimately takes longer than this on CPU should be paged in smaller regions, not given a longer clock. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global `fetch` (Node 20+, no extra dependency). */
  fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:8088';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Raised when the sidecar cannot be reached at all — connection refused,
 * DNS failure on a misconfigured `baseUrl`, or every retry timing out.
 * Distinguished from a normal thrown error so a caller (or a log line) does
 * not have to pattern-match a fetch error message to tell "the model
 * returned garbage" apart from "the model is not running".
 */
export class SidecarUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(
      `docai-engine sidecar not reachable at ${baseUrl}. Is 'services/docai-engine' running? ` +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'SidecarUnavailableError';
    this.cause = cause;
  }
}

/** The shape lane E's contract promises for a 200 from POST /read. */
type SidecarReadResponse = {
  blocks: Block[];
  unreadable?: Document['unreadable'];
  engine: string;
  timings?: Record<string, number>;
};

function specFor(id: string): EngineSpec {
  return {
    id,
    // What PP-OCRv5 actually does per docs/OCR.md's T1 row: detection and
    // recognition. Layout is a separate small VLM (§4.3) fronting a
    // different engine; requesting 'layout' capability from this one would
    // be asking for something lane E's contract does not promise.
    capabilities: ['detect', 'recognise'],
    residency: 'self-hosted',
    requiresNetwork: false, // see file header
    // Apache-2.0 for BOTH generations — PP-OCRv5 per
    // docs/contracts/phase1-ocr-stage.md §5.1, and PP-OCRv6 per PaddleOCR's
    // own LICENSE. `violatesLicenceFloor()` passes either way, which is what
    // docs/GAPS.md A2 asks be confirmed rather than assumed.
    weightsLicence: 'apache-2.0',
    redistributable: true,
    tier: 1,
    medianSeconds: null, // unmeasured — docs/GAPS.md A4
    note: `${id} detection + recognition via the docai-engine Python sidecar (loopback HTTP).`,
  };
}

/**
 * Calls lane E's sidecar for one page (or one region of it).
 *
 * One retry, and only for failures a retry can plausibly fix — a dropped
 * connection or a timeout, not a 4xx (the request was wrong; asking again
 * changes nothing) and not a malformed 200 (the model is running and
 * answered; retrying re-runs the same deterministic-enough model on the same
 * bytes for no reason). Two attempts total, matching the contract's "one
 * retry", not one-plus-unbounded backoff — a sidecar that is actually down
 * should fail fast so the pipeline can escalate past it (pipeline.ts) rather
 * than stall a page behind it.
 */
export class SidecarEngine implements Engine {
  readonly spec: EngineSpec;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: SidecarConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    // The sidecar can be configured to run PP-OCRv5 or PP-OCRv6
    // (DOCAI_MODEL_TIER, docs/GAPS.md A2), so the id is no longer a constant
    // here. Hardcoding v5 would have made the registry describe an engine the
    // service is not running — same licence and capabilities today, and still
    // a lie of exactly the kind that costs a day when it stops being harmless.
    //
    // Span PROVENANCE does not depend on this: the sidecar stamps every span
    // with its own engine id and `read()` returns those blocks verbatim, so a
    // stored layout names the generation that actually read it either way.
    this.spec = specFor(config.engineId ?? 'ppocr-v5');
  }

  async read(input: PageInput): Promise<Partial<Document>> {
    const capabilities: Capability[] = ['detect', 'recognise'];
    const body = new FormData();
    body.set(
      'image',
      new Blob([toArrayBuffer(input.bytes)], { type: input.mimeType }),
      `page-${input.page.number}`,
    );
    // `params`, not `meta`, and a plain STRING rather than a Blob. Both halves
    // of that were wrong once and each failed differently:
    //
    //   - the name, because the Phase 1 contract left field names unstated and
    //     all three lanes guessed;
    //   - the type, because a Blob becomes a multipart FILE part with a
    //     filename, and the service declares this parameter as `Form(...)`,
    //     which rejects a file part with a 422. The adapter's own tests passed
    //     throughout — they asserted against a fake server that accepted
    //     anything — so this surfaced only when the shadow stage ran against
    //     the real sidecar and every page came back unreadable.
    body.set(
      'params',
      JSON.stringify({
        pageNumber: input.page.number,
        capabilities,
        region: input.region ?? null,
      }),
    );

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.attemptRead(body);
      } catch (err) {
        lastError = err;
      }
    }
    throw new SidecarUnavailableError(this.baseUrl, lastError);
  }

  private async attemptRead(body: FormData): Promise<Partial<Document>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/read`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        // A 4xx from a running sidecar is a real answer, not a transport
        // failure — surface it directly rather than folding it into
        // SidecarUnavailableError, which would tell the caller to go check
        // whether a process is running when the process is right there
        // answering "no".
        throw new Error(`docai-engine sidecar responded ${res.status} ${res.statusText}`);
      }
      const parsed = (await res.json()) as SidecarReadResponse;
      if (!Array.isArray(parsed.blocks)) {
        throw new Error("docai-engine sidecar response missing 'blocks' array");
      }
      return { blocks: parsed.blocks, unreadable: parsed.unreadable ?? [] };
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /health — not called by `read()`; exposed for a caller (or a startup check) that wants to confirm the sidecar is up before routing anything to it. */
  async health(): Promise<{ ok: boolean; models: Array<{ id: string; licence: string; loaded: boolean }>; device: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/health`, { signal: controller.signal });
    } catch (err) {
      // Transport-level failure only — connection refused, DNS, timeout.
      throw new SidecarUnavailableError(this.baseUrl, err);
    } finally {
      clearTimeout(timer);
    }
    // Reachable but unhappy is a different fact than not reachable at all;
    // it is NOT wrapped as SidecarUnavailableError, which would tell a
    // caller to go check whether a process is running when it just answered.
    if (!res.ok) throw new Error(`docai-engine sidecar /health responded ${res.status} ${res.statusText}`);
    return (await res.json()) as {
      ok: boolean;
      models: Array<{ id: string; licence: string; loaded: boolean }>;
      device: string;
    };
  }
}

/**
 * Raised when the sidecar's /health reports weights we are not allowed to
 * ship. The spec above (`specFor`) is a CLAIM about what should be running;
 * /health reports what IS running, and D23's floor applies to the real
 * weights, not the claim.
 */
export class SidecarLicenceFloorError extends Error {
  constructor(violations: Array<{ id: string; licence: string }>) {
    super(
      'Licence floor violation: the docai-engine sidecar reported weights this product may not ship — ' +
        violations.map((m) => `${m.id} (${m.licence})`).join(', ') +
        ". D23 allows only apache-2.0 or mit. The engine will not be used; fix the sidecar's image.",
    );
    this.name = 'SidecarLicenceFloorError';
  }
}

/**
 * Cross-checks the RUNNING sidecar's licences (`/health`, whose `licence`
 * field carries the sidecar's own `WEIGHTS_LICENCE`) against the same floor
 * `violatesLicenceFloor()` applies to registry specs — the function whose
 * existence this honours, applied to what is actually loaded rather than
 * what we wrote down.
 *
 * Fail-closed on the licence STRING as well: the sidecar reports it as a
 * free-form string, and a licence we cannot name is not one we can call
 * redistributable. Only 'none' is exempt, exactly as the floor treats the
 * pdf text layer — no weights, nothing to redistribute.
 */
export async function assertSidecarLicenceFloor(engine: SidecarEngine): Promise<void> {
  const health = await engine.health();
  const violations = violatesLicenceFloor(
    health.models.map((m) => ({
      ...engine.spec,
      id: m.id,
      weightsLicence: m.licence as WeightsLicence,
      redistributable: true,
    })),
  );
  if (violations.length > 0) {
    throw new SidecarLicenceFloorError(
      violations.map((v) => ({ id: v.id, licence: v.weightsLicence as string })),
    );
  }
}

/** `Blob` wants an `ArrayBuffer`/`ArrayBufferView`; `PageInput.bytes` is typed as the wider `Uint8Array`. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}
