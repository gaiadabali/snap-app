import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import type { Page } from '../docdom.js';
import type { PageInput } from '../registry.js';
import { SidecarEngine, SidecarUnavailableError } from './sidecar.js';

/**
 * These tests run against a FAKE HTTP server standing in for lane E's
 * sidecar (docs/contracts/phase1-ocr-stage.md §5.4), never a live
 * `services/docai-engine` process — see that directory's state as of this
 * writing (install smoke tests only, no server yet). What this proves: this
 * adapter's request/response handling, timeout, retry and error reporting
 * match the DOCUMENTED contract. What it cannot prove: that lane E's actual
 * process answers the way its own documentation says it will — that needs a
 * real integration pass once `services/docai-engine` exists, which is out
 * of this lane's scope.
 */

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

function fakePage(overrides: Partial<Page> = {}): Page {
  return { number: 1, width: 100, height: 100, dpi: 200, source: 'pdf-render', restoration: [], ...overrides };
}

function fakeInput(overrides: Partial<PageInput> = {}): PageInput {
  return { page: fakePage(), bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', ...overrides };
}

/** Starts a fake sidecar on an ephemeral port and returns its base URL. */
async function startFakeSidecar(
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('SidecarEngine — spec', () => {
  it('is tier 1, self-hosted, Apache-2.0, and requiresNetwork: false despite calling fetch', () => {
    const engine = new SidecarEngine();
    expect(engine.spec.tier).toBe(1);
    expect(engine.spec.residency).toBe('self-hosted');
    expect(engine.spec.weightsLicence).toBe('apache-2.0');
    // See sidecar.ts's file header: this is a loopback process boundary,
    // not an egress boundary, and an air-gapped profile must still permit
    // it — that is the whole point of the field being named this way.
    expect(engine.spec.requiresNetwork).toBe(false);
  });
});

describe('SidecarEngine — happy path', () => {
  it('POSTs to /read and returns the DocDOM-shaped blocks verbatim', async () => {
    let sawMethod: string | undefined;
    let sawUrl: string | undefined;
    const baseUrl = await startFakeSidecar((req, res) => {
      sawMethod = req.method;
      sawUrl = req.url;
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            blocks: [
              {
                id: 'b0',
                kind: 'unknown',
                box: { x: 0, y: 0, width: 10, height: 10 },
                page: 1,
                order: 0,
                lines: [],
                provenance: { engine: 'ppocr-v5', confidence: 0.92, calibrated: false },
              },
            ],
            unreadable: [],
            engine: 'ppocr-v5',
            timings: { totalMs: 12 },
          }),
        );
      });
    });

    const engine = new SidecarEngine({ baseUrl });
    const result = await engine.read(fakeInput());

    expect(sawMethod).toBe('POST');
    expect(sawUrl).toBe('/read');
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks![0]!.provenance.engine).toBe('ppocr-v5');
    expect(result.unreadable).toEqual([]);
  });

  /**
   * The service declares `params` as a form FIELD, and a Blob is sent as a
   * multipart FILE part with a filename — which FastAPI's `Form(...)` rejects
   * with a 422.
   *
   * This is exactly what shipped, and every test above passed the whole time,
   * because a fake server that accepts anything cannot tell a field from a
   * file. It surfaced only when the shadow stage ran against the real sidecar
   * and every page came back unreadable. So this test looks at the wire.
   */
  it('sends params as a form field, not a file part', async () => {
    let rawBody = '';
    const baseUrl = await startFakeSidecar((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        rawBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ blocks: [], unreadable: [] }));
      });
    });

    await new SidecarEngine({ baseUrl }).read(fakeInput());

    const paramsPart = rawBody
      .split('--')
      .find((part) => part.includes('name="params"'));
    expect(paramsPart).toBeDefined();
    // A filename here means it arrived as a file, and the service refuses it.
    expect(paramsPart).not.toContain('filename=');
    // The image, by contrast, is legitimately a file part.
    const imagePart = rawBody.split('--').find((part) => part.includes('name="image"'));
    expect(imagePart).toContain('filename=');
  });

  it('answers GET /health', async () => {
    const baseUrl = await startFakeSidecar((req, res) => {
      expect(req.method).toBe('GET');
      expect(req.url).toBe('/health');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, models: [{ id: 'ppocr-v5', licence: 'apache-2.0', loaded: true }], device: 'cpu' }));
    });

    const health = await new SidecarEngine({ baseUrl }).health();
    expect(health.ok).toBe(true);
    expect(health.device).toBe('cpu');
  });
});

describe('SidecarEngine — retry', () => {
  it('retries exactly once on a transport failure, then succeeds', async () => {
    let attempts = 0;
    const fetchImpl = (async (url: string | URL, opts?: RequestInit) => {
      attempts++;
      if (attempts === 1) throw new Error('ECONNRESET (simulated)');
      // Second attempt: behave like a real successful sidecar response.
      return new Response(JSON.stringify({ blocks: [], unreadable: [], engine: 'ppocr-v5' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const engine = new SidecarEngine({ baseUrl: 'http://127.0.0.1:1', fetchImpl });
    const result = await engine.read(fakeInput());

    expect(attempts).toBe(2);
    expect(result.blocks).toEqual([]);
  });

  it('gives up after the retry and raises SidecarUnavailableError, not a raw fetch error', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED (simulated)');
    }) as unknown as typeof fetch;

    const engine = new SidecarEngine({ baseUrl: 'http://127.0.0.1:1', fetchImpl });

    await expect(engine.read(fakeInput())).rejects.toBeInstanceOf(SidecarUnavailableError);
  });
});

describe('SidecarEngine — sidecar not running', () => {
  it('raises a clear, actionable error when nothing is listening on the port', async () => {
    // Port 1 is a privileged, essentially-never-bound port — nothing should
    // be listening there in a test environment, giving a real (not
    // simulated) connection-refused without needing to bind and then close
    // a server first.
    const engine = new SidecarEngine({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 });

    await expect(engine.read(fakeInput())).rejects.toThrow(SidecarUnavailableError);
    await expect(engine.read(fakeInput())).rejects.toThrow(/not reachable/);
  });
});

describe('SidecarEngine — timeout', () => {
  it('times out and retries when the sidecar accepts the connection but never responds', async () => {
    let connections = 0;
    const baseUrl = await startFakeSidecar((_req, _res) => {
      connections++;
      // Deliberately never call res.end() — simulates a hung model call.
    });

    const engine = new SidecarEngine({ baseUrl, timeoutMs: 100 });
    await expect(engine.read(fakeInput())).rejects.toBeInstanceOf(SidecarUnavailableError);
    expect(connections).toBe(2); // one attempt, one retry
  });
});

describe('SidecarEngine — malformed responses', () => {
  it('treats a non-2xx from a running sidecar as an engine failure, not "not running"', async () => {
    const baseUrl = await startFakeSidecar((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'model crashed' }));
    });

    const engine = new SidecarEngine({ baseUrl });
    // Still surfaces as SidecarUnavailableError after the retry (both
    // attempts fail the same way) — but it wraps a real HTTP-status error,
    // not a connection failure. The message should reflect that, not claim
    // the process isn't running when it just answered 500 twice.
    await expect(engine.read(fakeInput())).rejects.toThrow(SidecarUnavailableError);
  });

  it('rejects a 200 that is missing the required `blocks` array', async () => {
    const baseUrl = await startFakeSidecar((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ engine: 'ppocr-v5' }));
    });

    const engine = new SidecarEngine({ baseUrl });
    await expect(engine.read(fakeInput())).rejects.toThrow(SidecarUnavailableError);
  });
});
