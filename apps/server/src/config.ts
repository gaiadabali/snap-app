import { z } from 'zod';

/**
 * Configuration, validated once at startup.
 *
 * Nothing reads `process.env` anywhere else. A server that discovers a missing
 * variable on the first request that needs it fails in production at 3am; this
 * one refuses to start, which is the only good time to find out.
 *
 * There are no defaults for secrets. A development fallback for a signing key
 * is how a development signing key ends up in production.
 */
const schema = z.object({
  /**
   * Must NOT be a superuser.
   *
   * A superuser has `rolbypassrls`, so no row-level security policy is ever
   * evaluated for it — every tenant boundary in the database silently stops
   * existing. Connect as the `snap_app` role (`node scripts/db.mjs appuser`),
   * which is NOSUPERUSER NOBYPASSRLS and a member of `app_rw`.
   *
   * `/v1/ready` reports which role is in use and whether it bypasses RLS.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (see pnpm db:up)'),

  /**
   * The worker's own connection. Falls back to DATABASE_URL.
   *
   * The worker needs one privilege the API must never have: `app_worker`
   * carries a policy on `jobs` — and only on `jobs` — that spans tenants, so a
   * queue consumer can see work it has no tenant context for. Having claimed a
   * job it re-enters through `withTenant` with that job's own tenant, which is
   * what keeps the elevated read confined to the queue table.
   *
   * Separate accounts, so the API is never one forgotten WHERE clause away
   * from another tenant's queue. `node scripts/db.mjs appuser` prints both.
   */
  WORKER_DATABASE_URL: z.string().min(1).optional(),

  PORT: z.coerce.number().int().positive().default(4000),

  /**
   * How this server is reached from OUTSIDE.
   *
   * Needed because an OAuth redirect_uri is sent to the provider and compared
   * against what is registered with them; it cannot be derived from the
   * incoming request, which may have come through a load balancer that
   * rewrote the host. Wrong here means a consent screen that ends in an error
   * page nobody can debug from the app.
   */
  PUBLIC_URL: z.string().url().default('http://127.0.0.1:4000'),

  /**
   * Origins allowed to call this API from a browser.
   *
   * Comma-separated. An ALLOW-LIST, never `*`: these responses carry someone's
   * financial records, and a wildcard lets any page the user has open read
   * them. Empty refuses every cross-origin browser request, which is the right
   * default for a server that has not been told who its client is.
   *
   * Native apps are unaffected — they are not subject to CORS at all.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  /**
   * HMAC key for session and upload tokens.
   *
   * Sessions are stateless: the token carries the user id and a signature, so
   * verifying one costs no database round trip. That is only safe while this
   * key is secret and long, hence the minimum.
   */
  TOKEN_SECRET: z.string().min(32, 'TOKEN_SECRET must be at least 32 characters'),

  /**
   * Where original captures are written.
   *
   * A local directory standing in for object storage. The CLIENT contract is
   * identical either way — it PUTs bytes to a URL it was handed — so swapping
   * in S3 changes this module and nothing else.
   */
  STORAGE_DIR: z.string().default('.storage'),

  /** How long an upload URL is good for. Short: it is a bearer credential. */
  UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * How long a signed `/v1/images/:token` URL is good for.
   *
   * `DocumentView.imageUrl` and `pages[].imageUrl` (`docs/contracts/
   * phase0-multipage.md` §8) are minted fresh on every read of a document, so
   * this only needs to outlive one screen's worth of fetching — not the
   * document's lifetime, which is what would happen if this were stored in a
   * row instead of minted per request.
   */
  IMAGE_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  /** Which extraction provider the worker uses. */
  EXTRACTION_PROVIDER: z.enum(['ollama', 'bedrock']).default('ollama'),
  EXTRACTION_MODEL: z.string().default('gemma4:31b'),

  /**
   * Per-tenant DAILY budget on extraction jobs admitted at intake.
   *
   * The second half of the statement-extraction cost caps (plan Task 10,
   * audit item 20): the page cap in `pdf-statement-import.ts` bounds what ONE
   * document may cost, and this bounds what ONE tenant may spend in a day.
   * `captures.controller.ts` counts today's `extract` jobs for the tenant
   * (one query) and refuses intake with 429 once this number is reached.
   *
   * 200 is a staging default, not a measured figure — roughly 200 receipts
   * photographed in a day by one small business, stated as a guess so the
   * cap exists at all rather than being presented as capacity planning.
   * Override per deployment with the env var; production should set it
   * deliberately.
   */
  EXTRACTION_DAILY_BUDGET: z.coerce.number().int().positive().default(200),

  /**
   * GLOBAL rate limit, requests per minute per source IP, enforced by the
   * middleware in `main.ts` ahead of every route (remediation Task 17).
   *
   * Distinct from the per-endpoint limiters in `auth.controller.ts`, which
   * bound specific expensive actions (sign-in, registration); this bounds
   * the whole API per caller so no endpoint is left unthrottled by default.
   * 300/min/IP is a starting point, not a measured capacity figure —
   * production should set it deliberately, like EXTRACTION_DAILY_BUDGET.
   */
  GLOBAL_RATE_LIMIT: z.coerce.number().int().positive().default(300),

  /** Where the provider key lives, when it is not already in the environment. */
  OLLAMA_ENV_FILE: z.string().optional(),
  OLLAMA_API_KEY: z.string().optional(),

  /**
   * The OCR stage's sidecar, run in SHADOW alongside the VLM extraction —
   * `docs/contracts/phase1b-shadow-stage.md` §3. Optional on purpose: this is
   * the one switch the whole feature hangs off. Unset, the worker calls
   * `@snap/docai` zero times and produces zero rows in `document_layouts` —
   * not "disabled", simply never invoked, which is what makes today's
   * behaviour provable rather than merely intended (§5 of that contract).
   */
  DOCAI_SIDECAR_URL: z.string().url().optional(),

  /**
   * Wall-clock budget for the ENTIRE shadow stage for one job, not per
   * sidecar call. Extraction itself has no coded timeout — a provider outage
   * delays a capture rather than losing it (`worker.ts`'s own header
   * comment) — so this is deliberately a hard, finite ceiling where
   * extraction has none: the shadow stage can never be the reason a job runs
   * longer than this on top of extraction, however slow or wedged the
   * sidecar is.
   */
  /**
   * Whole-stage budget for the shadow OCR pass.
   *
   * 30s was the first guess and it was too small to ever succeed: PP-OCRv5 on
   * CPU takes roughly 20 seconds on one full-page PDF render, so a two-page
   * document could not finish inside it. Shadow work runs after the document
   * is already saved and cannot change it, so a generous budget costs
   * throughput on the worker and nothing else.
   */
  DOCAI_SHADOW_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * This site's public web origin.
   *
   * Only needed to build the link inside a magic-link email — nobody browses
   * to the API directly. Optional in spirit (a worker process never sends a
   * magic link) but given a working default so `config()` does not refuse to
   * start over a variable most deployments of this process never touch.
   */
  WEB_PUBLIC_URL: z.string().url().default('http://127.0.0.1:3000'),

  /**
   * Google's OAuth client id, for checking the `aud` claim on a Google ID
   * token this server is asked to trust.
   *
   * Deliberately just the client id, never the secret. Verifying a JWT's
   * signature against Google's published JWKS needs no secret at all, and the
   * OAuth client that DOES hold one is the web app, not this server — see
   * `apps/web/src/lib/config.ts#googleOauth`. Optional so this server starts
   * fine before staging credentials exist; the Google sign-in endpoint
   * refuses cleanly (501) until it is set, rather than this whole process
   * refusing to boot over a feature nobody has wired up yet.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),

  /**
   * A distinct signal that this deployment IS the public staging/demo host —
   * see `isGoogleSignInSimulatorEnabled` below for what it gates. Kept wholly
   * separate from `NODE_ENV` on purpose: the demo host runs the same build as
   * production (so `NODE_ENV` really may be `'production'` there), and a flag
   * that only meant "not production" would already be true on every developer
   * laptop. `z.enum` rather than a free string so a typo fails config
   * validation loudly instead of silently leaving the demo host unreachable.
   */
  DEMO_ENV: z.enum(['staging']).optional(),

  /**
   * Explicit opt-in for the simulated Google sign-in — see
   * `isGoogleSignInSimulatorEnabled`. Defaults to off and is never inferred
   * from `DEMO_ENV` or anything else: enabling the demo host and enabling
   * this authentication bypass are two separate decisions, made with two
   * separate variables, same as `SNAP_DEV_AUTH_BYPASS` is kept separate from
   * `NODE_ENV` for the development bypass.
   */
  GOOGLE_SIGNIN_SIMULATOR: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * Explicit opt-in for the MANUAL credit fulfilment endpoint — see
   * `isManualCreditFulfilmentEnabled`. Defaults to off, and like
   * `GOOGLE_SIGNIN_SIMULATOR` it is never inferred from `DEMO_ENV`: running a
   * demo host and letting that host mint paid credits without money are two
   * different decisions.
   */
  CREDITS_MANUAL_FULFIL: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** True in production, where several behaviours must be stricter. */
export const isProduction = (): boolean => config().NODE_ENV === 'production';

/**
 * Whether the SIMULATED Google sign-in may run right now — a deliberate
 * authentication bypass built for exactly one purpose: an investor demo on a
 * public host that has no real Google OAuth credentials yet and whose mailer
 * is still `NoopMailer` (`auth/mailer.ts`), so today literally nobody can
 * sign in there at all (docs/DEPLOY.md §3).
 *
 * Three independent conditions, ALL required — one more than
 * `apps/web/src/lib/auth/dev-bypass.ts`'s two, because that one never leaves
 * a developer's own machine and this one runs on a host anyone can find:
 *
 *   1. `NODE_ENV !== 'production'` OR `DEMO_ENV === 'staging'`. The second
 *      disjunct exists because the demo host is typically the SAME build as
 *      production — so `NODE_ENV` alone cannot be the signal, and a plain
 *      production deployment that never sets `DEMO_ENV` fails this outright.
 *   2. `GOOGLE_SIGNIN_SIMULATOR === true` — a second, independent opt-in.
 *      "This is the demo host" and "this demo host may bypass authentication"
 *      are different decisions; conflating them would mean the mere act of
 *      marking a deployment "staging" turns the bypass on.
 *   3. Real Google credentials are NOT configured. The instant
 *      `GOOGLE_CLIENT_ID` is set, this returns `false` unconditionally — the
 *      genuine OAuth + PKCE + JWKS-verified flow always wins, and nobody has
 *      to remember to flip the other two flags back off once it exists.
 *
 * Called from both sides of the boundary it guards: `AuthController` calls it
 * again immediately before minting a session — that second call is the real
 * boundary, not this one, same as `isDevBypassAvailable`'s own comment.
 */
/**
 * Whether `POST /v1/credits/purchases/:id/fulfil` may run — the manual
 * stand-in for a payment processor's webhook.
 *
 * ── Why this gate had to exist before anything else was built ──────────────
 *
 * That endpoint atomically marks a purchase paid and inserts the
 * `usage_grants` row. It is guarded by `requireAdmin`, which sounds like a
 * control and is not one: `workspaces.controller.ts` gives the creator of a
 * workspace the `owner` role, so every self-service signup is an owner of
 * their own tenant. Two calls — start a purchase, then fulfil it — and the
 * credits are granted. No money moves, because there is nowhere for money to
 * move to.
 *
 * While there was no payment path at all that was honest: the whole feature
 * was a stand-in and said so. Credits are now the entire commercial model, so
 * the same two calls are the revenue model with a hole in it — and it would
 * not have looked like a new bug, because the code would not have changed.
 *
 * Same lesson as the sign-in bypass in `auth.controller.ts`, which carried
 * "must not ship" in a comment for a long time while nothing enforced it. A
 * comment is not a control.
 *
 * Two independent conditions, BOTH required — a plain production deployment
 * that sets neither fails this outright:
 *
 *   1. `NODE_ENV !== 'production'` OR `DEMO_ENV === 'staging'`, because the
 *      demo host runs the same build as production and needs to be able to
 *      demonstrate buying credits.
 *   2. `CREDITS_MANUAL_FULFIL === true`, a separate, deliberate opt-in.
 *
 * When a real processor is wired up, its webhook handler replaces this — it
 * runs the same repo function keyed by `provider` + `provider_ref`, and this
 * endpoint should be deleted rather than left switched off.
 */
export function isManualCreditFulfilmentEnabled(): boolean {
  const settings = config();
  const demoHost = settings.NODE_ENV !== 'production' || settings.DEMO_ENV === 'staging';
  return demoHost && settings.CREDITS_MANUAL_FULFIL;
}

export function isGoogleSignInSimulatorEnabled(): boolean {
  const settings = config();
  const demoHost = settings.NODE_ENV !== 'production' || settings.DEMO_ENV === 'staging';
  const explicitOptIn = settings.GOOGLE_SIGNIN_SIMULATOR;
  const realGoogleConfigured = Boolean(settings.GOOGLE_CLIENT_ID);
  return demoHost && explicitOptIn && !realGoogleConfigured;
}
