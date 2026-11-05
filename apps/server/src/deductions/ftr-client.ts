import { config } from '../config.js';

/**
 * Posts one stored bundle to Free Tax Returns (docs/30 §4, §6): the exact bytes
 * hashed at the start, as `application/json`, with YourTal's assertion as the
 * bearer credential. FTR answers 201 `{importId}`, 200 with the same id for a
 * `jti` it already took, or `{err}` with a status (§4's table).
 *
 * The assertion is a credential for another party: it is passed on and never
 * decoded, logged or stored, and no error here carries it, a header or a body.
 * `redirect: 'error'`, so a redirect cannot carry it to another host.
 */

const TIMEOUT_MS = 15_000;
/** FTR's own 429 asks for a minute; a second's pause is all an assertion that lasts 15 minutes should cost. */
const RETRY_DELAY_MS = 1_000;
/** FTR's own `err` codes (docs/30 §4). Anything else is reported as `refused`. */
const REASON = /^[a-z_]{1,40}$/;

export type FtrResult =
  | { ok: true; importId: string }
  | { ok: false; kind: 'refused'; reason: string }
  | { ok: false; kind: 'unavailable' };

export function ftrTransferConfigured(): boolean {
  return Boolean(config().FTR_TRANSFER_URL);
}

async function once(assertion: string, bytes: Buffer): Promise<FtrResult> {
  let response: Response;
  try {
    response = await fetch(config().FTR_TRANSFER_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${assertion}` },
      body: new Uint8Array(bytes),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    /* no body */
  }
  if (response.status === 201 || response.status === 200) {
    const id = body.importId;
    return typeof id === 'string' && id.length > 0 && id.length <= 100
      ? { ok: true, importId: id }
      : { ok: false, kind: 'unavailable' };
  }
  // Busy or down: worth one more try while the assertion lasts.
  if (response.status === 429 || response.status >= 500) return { ok: false, kind: 'unavailable' };
  const reason = typeof body.err === 'string' && REASON.test(body.err) ? body.err : 'refused';
  return { ok: false, kind: 'refused', reason };
}

/** One try, and one more after an unavailable answer (429, 5xx, a timeout), with the same assertion. */
export async function postBundle(assertion: string, bytes: Buffer): Promise<FtrResult> {
  const first = await once(assertion, bytes);
  if (first.ok || first.kind !== 'unavailable') return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return once(assertion, bytes);
}
