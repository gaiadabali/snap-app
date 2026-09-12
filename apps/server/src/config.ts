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
