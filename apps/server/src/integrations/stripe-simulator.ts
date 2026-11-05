import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { isSimulationPermitted } from './simulation.js';

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
 * ── The checkout page (group task 7.5.a) ─────────────────────────────────
 *
 * `handle` serves the API above AND a hosted checkout page, so a browser can
 * pay: `main.ts` mounts it under `/stripe-sim` on the API's own host when
 * `STRIPE_SIMULATOR=true`. Stripe's test cards only — 4242 4242 4242 4242
 * pays, 4000 0000 0000 0002 is declined, anything else is refused — and the
 * number is read, matched and dropped: never stored, never logged. A paid
 * session's page offers a refund, standing in for Stripe's dashboard.
 *
 * Paying and refunding each send a signed event (`checkout.session.completed`,
 * `charge.refunded`) through `deliver`, retried while the app does not
 * answer 2xx, the way Stripe retries. The first attempt is awaited before
 * the browser is sent back, so the credits are usually there when it lands.
 *
 * It refuses to start where `integrations/simulation.ts` forbids simulators
 * (a production host without `DEMO_ENV=staging`), on top of that module
 * refusing to select it.
 */

/** Where `main.ts` mounts `handle` on the API's own host. */
export const STRIPE_SIM_PREFIX = '/stripe-sim';

/** Stripe's test cards, and nothing else. Keyed by digits. */
const TEST_CARDS: Record<string, 'ok' | 'declined'> = {
  '4242424242424242': 'ok',
  '4000000000000002': 'declined',
};

export interface SimulatedCheckoutSession {
  id: string;
  url: string;
  amountTotal: number | null;
  currency: string | null;
  clientReferenceId: string | null;
  metadata: Record<string, string>;
  /** `payment_intent_data[metadata]`: Stripe copies it onto the charge, which is what a refund event carries. */
  chargeMetadata: Record<string, string>;
  productName: string | null;
  successUrl: string | null;
  cancelUrl: string | null;
  paid: boolean;
  refunded: boolean;
  paymentIntentId: string | null;
}

export interface SignedEvent {
  body: string;
  signature: string;
}

export interface SimulatorResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface StripeSimulatorOptions {
  /** Where browsers reach the pages, e.g. `${PUBLIC_URL}/stripe-sim`. Defaults to the simulator's own address. */
  publicBase?: string;
  /** Sends one signed event to the app's webhook; must throw (or reject) unless the app answered 2xx. */
  deliver?: (event: SignedEvent) => Promise<unknown>;
  /** Waits between delivery attempts after the first. Stripe retries for days; this gives up sooner. */
  retryDelaysMs?: readonly number[];
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
   * "The customer paid", for a test. Returns the raw body and signature header exactly
   * as Stripe would send them, for the test to POST at the webhook route.
   * Does NOT deliver it itself — the handler under test should be invoked
   * the same way Stripe invokes it.
   */
  readonly pay: (
    sessionId: string,
    options?: { timestampSeconds?: number; secret?: string },
  ) => SignedEvent;
  /** One request, API or page, with the path relative to the mount. `main.ts` routes `/stripe-sim/*` here. */
  readonly handle: (
    method: string,
    url: string,
    headers: IncomingHttpHeaders,
    body: string,
  ) => Promise<SimulatorResponse>;
  readonly close: () => Promise<void>;
}

/** Parse Stripe's bracketed form encoding back into a nested object. */
function parseForm(body: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of body.split('&')) {
    if (!pair) continue;
    const [rawKey, rawValue = ''] = pair.split('=');
    const key = decodeURIComponent(rawKey!.replace(/\+/g, ' '));
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

function json(status: number, body: unknown): SimulatorResponse {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function originOf(url: string | null): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

const STYLE =
  'body{margin:0;background:#f6f9fc;color:#1a1f36;font:16px/1.5 system-ui,sans-serif}' +
  'main{max-width:420px;margin:0 auto;padding:24px 16px}' +
  '.banner{background:#fff4d6;border:1px solid #e5c76b;border-radius:6px;padding:8px 12px;font-size:14px;margin-bottom:16px}' +
  '.card{background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.15)}' +
  'h1{font-size:20px;margin:0 0 4px}.sub{color:#4f566b;margin:0 0 16px}' +
  'label{display:block;font-size:14px;margin:12px 0 4px}' +
  'input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c0c8d4;border-radius:6px;font:inherit}' +
  '.err{color:#b3261e;margin:0 0 12px}.hint{color:#4f566b;font-size:14px}' +
  'button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:6px;background:#635bff;color:#fff;font:inherit;cursor:pointer}' +
  'button.secondary{background:#e3e8ee;color:#1a1f36}a{color:#635bff}';

export async function startStripeSimulator(
  options: StripeSimulatorOptions = {},
): Promise<StripeSimulator> {
  if (!isSimulationPermitted()) {
    throw new Error(
      'The Stripe simulator refuses to start on a production host without DEMO_ENV=staging.',
    );
  }
  const secretKey = `sk_test_sim_${randomBytes(12).toString('hex')}`;
  const webhookSecret = `whsec_sim_${randomBytes(16).toString('hex')}`;
  const sessions: SimulatedCheckoutSession[] = [];
  const retryDelays = options.retryDelaysMs ?? [5_000, 30_000, 120_000, 600_000];
  let apiBase = '';

  /** The real scheme: HMAC-SHA256 over `${timestamp}.${rawBody}`, hex. */
  function sign(body: string, timestamp: number, secret = webhookSecret): string {
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${v1}`;
  }

  function event(type: string, object: Record<string, unknown>): string {
    return JSON.stringify({
      id: `evt_test_${randomBytes(12).toString('hex')}`,
      object: 'event',
      type,
      data: { object },
    });
  }

  function completedEvent(session: SimulatedCheckoutSession): string {
    return event('checkout.session.completed', {
      id: session.id,
      object: 'checkout.session',
      amount_total: session.amountTotal,
      currency: session.currency,
      client_reference_id: session.clientReferenceId,
      metadata: session.metadata,
      payment_intent: session.paymentIntentId,
      payment_status: 'paid',
      status: 'complete',
    });
  }

  function markPaid(session: SimulatedCheckoutSession): void {
    session.paid = true;
    session.paymentIntentId ??= `pi_test_${randomBytes(12).toString('hex')}`;
  }

  /**
   * Delivers one event, re-signed on every attempt as Stripe does. Only the
   * first attempt is awaited; the retries run on timers and stop after the
   * last delay.
   */
  async function send(body: string): Promise<void> {
    const deliver = options.deliver;
    if (!deliver) return;
    const attempt = async (n: number): Promise<void> => {
      try {
        await deliver({ body, signature: sign(body, Math.floor(Date.now() / 1000)) });
      } catch {
        const wait = retryDelays[n];
        if (wait !== undefined) setTimeout(() => void attempt(n + 1), wait).unref();
      }
    };
    await attempt(0);
  }

  function page(
    session: SimulatedCheckoutSession,
    error: string | null = null,
    status = 200,
  ): SimulatorResponse {
    const amount =
      session.amountTotal === null
        ? ''
        : `${(session.currency ?? 'aud').toUpperCase()} ${(session.amountTotal / 100).toFixed(2)}`;
    const head = `<h1>${esc(session.productName ?? 'Snap Apps')}</h1><p class="sub">${esc(amount)}</p>`;
    let body: string;
    if (session.refunded) {
      body = `${head}<p>Refunded. The scans this bought have been taken back.</p>`;
    } else if (session.paid) {
      body =
        `${head}<p>Paid.</p>` +
        (session.successUrl ? `<p><a href="${esc(session.successUrl)}">Back to Snap Apps</a></p>` : '') +
        `<form method="post"><input type="hidden" name="op" value="refund">` +
        `<button class="secondary" type="submit">Refund this payment</button></form>`;
    } else {
      body =
        head +
        (error ? `<p class="err" role="alert">${esc(error)}</p>` : '') +
        `<form method="post"><input type="hidden" name="op" value="pay">` +
        `<label for="card">Card number</label>` +
        `<input id="card" name="card" inputmode="numeric" autocomplete="off" required>` +
        `<p class="hint">Test cards only: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.</p>` +
        `<button type="submit">Pay ${esc(amount)}</button></form>` +
        (session.cancelUrl ? `<p><a href="${esc(session.cancelUrl)}">Cancel</a></p>` : '');
    }
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      `<title>Checkout</title><style>${STYLE}</style></head><body><main>` +
      '<div class="banner" role="note">Simulated payment, no real money.</div>' +
      `<div class="card">${body}</div></main></body></html>`;
    // No scripts at all. `form-action` must name the success origin too:
    // Chrome applies it to the redirect that follows the POST.
    const formAction = ["'self'", originOf(session.successUrl)].filter(Boolean).join(' ');
    return {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
        'referrer-policy': 'no-referrer',
      },
      body: html,
    };
  }

  async function submit(session: SimulatedCheckoutSession, body: string): Promise<SimulatorResponse> {
    const form = parseForm(body);
    if (pick(form, 'op') === 'refund') {
      if (session.paid && !session.refunded) {
        session.refunded = true;
        await send(
          event('charge.refunded', {
            id: `ch_test_${randomBytes(12).toString('hex')}`,
            object: 'charge',
            amount: session.amountTotal,
            amount_refunded: session.amountTotal,
            currency: session.currency,
            payment_intent: session.paymentIntentId,
            refunded: true,
            metadata: session.chargeMetadata,
          }),
        );
      }
      return page(session);
    }
    if (session.paid) return page(session);

    // Matched and dropped: the number goes nowhere else.
    const outcome = TEST_CARDS[(pick(form, 'card') ?? '').replace(/\D/g, '')];
    if (!outcome) {
      return page(session, 'That is not a test card. This checkout takes test cards only.', 400);
    }
    if (outcome === 'declined') {
      return page(session, 'Your card was declined. Nothing was charged.', 402);
    }
    markPaid(session);
    await send(completedEvent(session));
    if (!session.successUrl) return page(session);
    return { status: 303, headers: { location: session.successUrl }, body: '' };
  }

  function createSession(headers: IncomingHttpHeaders, body: string): SimulatorResponse {
    // Stripe's own 401 shape. An unauthenticated call must never look like
    // a successful one, and the client's handling of that should not be
    // theoretical.
    if (headers.authorization !== `Bearer ${secretKey}`) {
      return json(401, {
        error: { type: 'invalid_request_error', message: 'Invalid API Key provided' },
      });
    }

    const form = parseForm(body);
    const unitAmount = pick(form, 'line_items', '0', 'price_data', 'unit_amount');
    const currency = pick(form, 'line_items', '0', 'price_data', 'currency');

    // If the provider's form encoding is wrong, these are undefined and
    // the session comes back with nulls — the test fails loudly rather
    // than a malformed request quietly succeeding.
    const id = `cs_test_${randomBytes(12).toString('hex')}`;
    const session: SimulatedCheckoutSession = {
      id,
      url: `${options.publicBase ?? apiBase}/checkout/pay/${id}`,
      amountTotal: unitAmount === undefined ? null : Number(unitAmount),
      currency: currency ?? null,
      clientReferenceId: pick(form, 'client_reference_id') ?? null,
      metadata: (form.metadata ?? {}) as Record<string, string>,
      chargeMetadata:
        (form.payment_intent_data as { metadata?: Record<string, string> } | undefined)?.metadata ??
        {},
      productName: pick(form, 'line_items', '0', 'price_data', 'product_data', 'name') ?? null,
      successUrl: pick(form, 'success_url') ?? null,
      cancelUrl: pick(form, 'cancel_url') ?? null,
      paid: false,
      refunded: false,
      paymentIntentId: null,
    };
    sessions.push(session);

    return json(200, {
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
  }

  async function handle(
    method: string,
    url: string,
    headers: IncomingHttpHeaders,
    body: string,
  ): Promise<SimulatorResponse> {
    const path = url.split('?')[0] ?? '';
    if (method === 'POST' && path === '/v1/checkout/sessions') return createSession(headers, body);

    const match = /^\/checkout\/pay\/(cs_test_[0-9a-f]+)$/.exec(path);
    const session = match ? sessions.find((s) => s.id === match[1]) : undefined;
    if (session && method === 'GET') return page(session);
    if (session && method === 'POST') return submit(session, body);

    return json(404, {
      error: { type: 'invalid_request_error', message: `Unrecognized request URL: ${path}` },
    });
  }

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void handle(req.method ?? 'GET', req.url ?? '', req.headers, Buffer.concat(chunks).toString('utf8'))
        .then((r) => {
          res.writeHead(r.status, { ...r.headers, 'content-length': Buffer.byteLength(r.body) });
          res.end(r.body);
        })
        .catch(() => {
          res.writeHead(500);
          res.end();
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  apiBase = `http://127.0.0.1:${port}`;

  return {
    apiBase,
    secretKey,
    webhookSecret,
    sessions,
    last: () => sessions[sessions.length - 1],
    handle,
    pay(sessionId, opts = {}) {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) throw new Error(`No simulated session ${sessionId}`);
      markPaid(session);
      const body = completedEvent(session);
      // `secret` is overridable so a test can sign with the WRONG key and
      // prove the verification refuses it.
      return {
        body,
        signature: sign(body, opts.timestampSeconds ?? Math.floor(Date.now() / 1000), opts.secret),
      };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
