import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A simulated Stripe that signs real signatures.
 *
 * `docs/INTEGRATIONS.md` ticket P3, and the objection it answers is written
 * in `credits/payment-provider.ts`:
 *
 *   "No fake provider that 'succeeds'. A stub that completes a checkout
 *    would make the buy button work in development and fail in production."
 *
 * That objection is correct and this is not that. A stub would implement
 * `PaymentProvider` and return `{state: 'redirect', url: '...'}` without
 * talking to anything, and would then have to fake the fulfilment too —
 * which means granting credits with no webhook, which means the one code
 * path that must never be wrong is the one never exercised.
 *
 * This is an HTTP server. `StripePaymentProvider` posts a real
 * `application/x-www-form-urlencoded` body to `/v1/checkout/sessions` with
 * bracketed nested keys, gets back Stripe's JSON shape, and — when the
 * "customer pays" — receives a `checkout.session.completed` event carrying a
 * genuine `Stripe-Signature: t=...,v1=<HMAC-SHA256 of "t.payload">`.
 * `verifyStripeSignature` runs for real against it.
 *
 * So credits are still granted only by a signature-verified webhook, exactly
 * as in production. The only untested line when a live key arrives is the
 * key.
 *
 * ── What it deliberately gets right ──────────────────────────────────────
 *
 *  * **Rejects a bad API key** with Stripe's 401 error shape, because an
 *    unauthenticated call must not look like a successful one.
 *  * **Parses the real form encoding.** If the provider builds
 *    `line_items[0][price_data][unit_amount]` wrongly, the session comes
 *    back missing an amount and the test fails — which is the single most
 *    likely integration bug and the reason this is not a JSON stub.
 *  * **Signs with a secret it minted**, so the verification path is real
 *    rather than agreed in advance.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not a payment system. No money, no cards, no 3DS. `pay()` is a method a
 * TEST calls; there is no button. It is triple-gated by
 * `integrations/simulation.ts` and cannot be selected on a production host
 * that has not declared itself a demo.
 */

export interface SimulatedCheckoutSession {
  id: string;
  url: string;
  amountTotal: number | null;
  currency: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  productName: string | null;
  paid: boolean;
}

export interface StripeSimulator {
  /** Pass as `apiBase` to `StripePaymentProvider`. */
  readonly apiBase: string;
  readonly secretKey: string;
  readonly webhookSecret: string;
  /** Every session created so far. */
  readonly sessions: SimulatedCheckoutSession[];
  readonly last: () => SimulatedCheckoutSession | undefined;
  /**
   * "The customer paid." Returns the raw body and signature header exactly
   * as Stripe would send them, for the test to POST at the webhook route.
   * Does NOT deliver it itself — the handler under test should be invoked
   * the same way Stripe invokes it.
   */
  readonly pay: (
    sessionId: string,
    options?: { timestampSeconds?: number; secret?: string },
  ) => { body: string; signature: string };
  readonly close: () => Promise<void>;
}

/** Parse Stripe's bracketed form encoding back into a nested object. */
function parseForm(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    const key = decodeURIComponent(rawKey!);
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    // `a[b][0][c]` -> ['a','b','0','c']
    const path = key.replace(/\]/g, '').split('[');
    let node = out;
    for (let i = 0; i < path.length - 1; i += 1) {
      const segment = path[i]!;
      if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
      node = node[segment] as Record<string, unknown>;
    }
    node[path[path.length - 1]!] = value;
  }
  return out;
}

function pick(source: unknown, ...path: string[]): string | undefined {
  let node: unknown = source;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : undefined;
}

export async function startStripeSimulator(): Promise<StripeSimulator> {
  const secretKey = `sk_test_sim_${randomBytes(12).toString('hex')}`;
  const webhookSecret = `whsec_sim_${randomBytes(16).toString('hex')}`;
  const sessions: SimulatedCheckoutSession[] = [];

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];

      if (req.method !== 'POST' || path !== '/v1/checkout/sessions') {
        return send(404, {
          error: { type: 'invalid_request_error', message: `Unrecognized request URL: ${path}` },
        });
      }

      // Stripe's own 401 shape. An unauthenticated call must never look like
      // a successful one, and the client's handling of that should not be
      // theoretical.
      if (req.headers.authorization !== `Bearer ${secretKey}`) {
        return send(401, {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid API Key provided',
          },
        });
      }

      const form = parseForm(Buffer.concat(chunks).toString('utf8'));
      const unitAmount = pick(form, 'line_items', '0', 'price_data', 'unit_amount');
      const currency = pick(form, 'line_items', '0', 'price_data', 'currency');

      // If the provider's form encoding is wrong, these are undefined and
      // the session comes back with nulls — the test fails loudly rather
      // than a malformed request quietly succeeding.
      const id = `cs_test_${randomBytes(12).toString('hex')}`;
      const metadataNode = (form.metadata ?? {}) as Record<string, string>;
      const session: SimulatedCheckoutSession = {
        id,
        url: `${apiBase}/checkout/pay/${id}`,
        amountTotal: unitAmount === undefined ? null : Number(unitAmount),
        currency: currency ?? null,
        clientReferenceId: pick(form, 'client_reference_id') ?? null,
        metadata: metadataNode,
        productName: pick(form, 'line_items', '0', 'price_data', 'product_data', 'name') ?? null,
        paid: false,
      };
      sessions.push(session);

      return send(200, {
        id: session.id,
        object: 'checkout.session',
        url: session.url,
        amount_total: session.amountTotal,
        currency: session.currency,
        client_reference_id: session.clientReferenceId,
        metadata: session.metadata,
        payment_status: 'unpaid',
        status: 'open',
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const apiBase = `http://127.0.0.1:${port}`;

  return {
    apiBase,
    secretKey,
    webhookSecret,
    sessions,
    last: () => sessions[sessions.length - 1],
    pay(sessionId, options = {}) {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error(`No simulated session ${sessionId}`);
      session.paid = true;

      const event = {
        id: `evt_test_${randomBytes(12).toString('hex')}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: session.id,
            object: 'checkout.session',
            amount_total: session.amountTotal,
            currency: session.currency,
            client_reference_id: session.clientReferenceId,
            metadata: session.metadata,
            payment_status: 'paid',
            status: 'complete',
          },
        },
      };
      const body = JSON.stringify(event);
      const timestamp = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
      // The real scheme: HMAC-SHA256 over `${timestamp}.${rawBody}`, hex.
      // `secret` is overridable so a test can sign with the WRONG key and
      // prove the verification refuses it.
      const signature = createHmac('sha256', options.secret ?? webhookSecret)
        .update(`${timestamp}.${body}`)
        .digest('hex');
      return { body, signature: `t=${timestamp},v1=${signature}` };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
