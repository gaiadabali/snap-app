/**
 * The real KMS: HashiCorp Vault's Transit secrets engine.
 *
 * `docs/INTEGRATIONS.md` Lane K. Chosen by the owner on 2026-09-21 over AWS
 * and GCP KMS for a reason specific to this deployment: delphi is a Hostinger
 * VPS that touches no cloud provider, and `docs/OCR.md` D17's air-gapped
 * profile forbids CDN egress outright. A KMS that runs as a container on the
 * same internal network keeps both true. It is a real KMS by the definition
 * that matters here — key material never leaves it, every operation is
 * authenticated and logged, and the key can be rotated without touching what
 * it has wrapped.
 *
 * ── Why Transit is exactly the seam kms.ts already drew ───────────────────
 *
 * `KmsProvider` is `wrap`/`unwrap` and nothing else, and its comment says
 * those are "the two calls a real provider would make over the network
 * instead of computing locally". Transit's two endpoints are literally that:
 *
 *   POST /v1/{mount}/encrypt/{key}   {"plaintext": "<base64>"}
 *                                 -> {"data": {"ciphertext": "vault:v1:..."}}
 *   POST /v1/{mount}/decrypt/{key}   {"ciphertext": "vault:v1:..."}
 *                                 -> {"data": {"plaintext": "<base64>"}}
 *
 * Vault never returns the key itself. We send it a 32-byte DEK and get back
 * an opaque string; that string is what lands in `wrapped_dek`.
 *
 * ── The `vault:v1:` prefix is load-bearing, not cosmetic ──────────────────
 *
 * The version in that prefix is how a rotated KEK stays backwards
 * compatible. `POST /v1/{mount}/keys/{key}/rotate` mints v2; everything
 * already wrapped still says `vault:v1:` and Vault still decrypts it with the
 * retained v1 key. That is the entire reason the envelope exists — rotating
 * the KEK must not mean re-encrypting every stored secret — so the prefix is
 * PARSED here and asserted in the suite rather than treated as an opaque
 * blob. A simulator that returned bare base64 would pass every test and then
 * fail the first time anybody rotated anything, which is why K2's simulator
 * emits the prefix too.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 *
 * No retry loop. A wrap happens once, interactively, when a staff member
 * submits a key; an unwrap happens on a path that already has to handle a
 * failure. Silently retrying a KMS call is how a transient auth failure
 * becomes a mystery, and Vault's own errors are specific enough to surface.
 *
 * No token renewal. `VAULT_TOKEN` is expected to be a periodic token renewed
 * by the platform (Vault Agent, or the compose entrypoint), not something
 * this process manages. If it expires, Vault answers 403 with a clear error
 * and that is what the operator sees.
 */

const DEFAULT_MOUNT = 'transit';
const DEFAULT_KEY = 'snap-dek';
const DEFAULT_TIMEOUT_MS = 5_000;

/** The `vault:vN:` envelope Vault puts on every Transit ciphertext. */
const VAULT_CIPHERTEXT_RE = /^vault:v(\d+):/;

export interface VaultTransitOptions {
  /** e.g. `http://vault:8200`. No trailing slash required. */
  address: string;
  token: string;
  /** The Transit mount path. `transit` unless someone mounted it elsewhere. */
  mount?: string;
  /** The named encryption key inside that mount. */
  keyName?: string;
  timeoutMs?: number;
}

export class VaultKmsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VaultKmsError';
  }
}

interface TransitEncryptResponse {
  data?: { ciphertext?: string };
  errors?: string[];
}

interface TransitDecryptResponse {
  data?: { plaintext?: string };
  errors?: string[];
}

export class VaultTransitKmsProvider {
  readonly id = 'vault';
  private readonly address: string;
  private readonly token: string;
  private readonly mount: string;
  private readonly keyName: string;
  private readonly timeoutMs: number;

  constructor(options: VaultTransitOptions) {
    if (!options.address) throw new VaultKmsError('VAULT_ADDR is required to use the Vault KMS.');
    if (!options.token) throw new VaultKmsError('VAULT_TOKEN is required to use the Vault KMS.');
    this.address = options.address.replace(/\/+$/, '');
    this.token = options.token;
    this.mount = options.mount ?? DEFAULT_MOUNT;
    this.keyName = options.keyName ?? DEFAULT_KEY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** What `kms_key_id` records for a key wrapped by this provider. */
  get keyId(): string {
    return `vault:${this.mount}/${this.keyName}`;
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.address}/v1/${this.mount}/${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Vault-Token': this.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // Network-level: Vault unreachable, DNS, or the timeout above. Named
      // distinctly from an auth failure because the operator response is
      // different — one is "the container is down", the other is "the token
      // is wrong".
      throw new VaultKmsError(
        `Vault at ${this.address} could not be reached: ${String(cause)}. ` +
          'The KMS is required to store or read a credential; nothing has been written.',
      );
    }

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new VaultKmsError(
        `Vault returned a non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`,
        response.status,
      );
    }

    if (!response.ok) {
      const errors = (parsed as { errors?: string[] }).errors ?? [];
      // Vault's own error text is specific ("permission denied", "encryption
      // key not found") and is the most useful thing an operator can be
      // given, so it is passed through rather than replaced.
      throw new VaultKmsError(
        `Vault refused the request (HTTP ${response.status}): ${
          errors.length ? errors.join('; ') : text.slice(0, 200)
        }`,
        response.status,
      );
    }

    return parsed as T;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    const body = await this.call<TransitEncryptResponse>(`encrypt/${this.keyName}`, {
      plaintext: dek.toString('base64'),
    });
    const ciphertext = body.data?.ciphertext;
    if (!ciphertext) {
      throw new VaultKmsError('Vault returned no ciphertext for an encrypt call.');
    }
    if (!VAULT_CIPHERTEXT_RE.test(ciphertext)) {
      // Refused rather than stored. A ciphertext without the version prefix
      // cannot survive a key rotation, and discovering that at rotation time
      // means discovering it on every stored secret at once.
      throw new VaultKmsError(
        `Vault returned a ciphertext without the expected "vault:vN:" prefix: ${ciphertext.slice(0, 32)}`,
      );
    }
    // Stored as UTF-8 bytes: `wrapped_dek` is bytea, and Vault's ciphertext
    // is a string. Round-tripping it as text is what keeps the version
    // prefix intact for the rotation path.
    return Buffer.from(ciphertext, 'utf8');
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const ciphertext = wrapped.toString('utf8');
    if (!VAULT_CIPHERTEXT_RE.test(ciphertext)) {
      // The most likely cause is real and worth naming: a DEK wrapped by the
      // LOCAL provider being read back after someone switched
      // ADMIN_KMS_PROVIDER to vault. Those bytes are AES-GCM output, not a
      // Vault ciphertext, and Vault would answer with a confusing 400.
      throw new VaultKmsError(
        'This wrapped DEK was not produced by Vault (no "vault:vN:" prefix). It was most likely ' +
          'wrapped by the LOCAL KMS stand-in before ADMIN_KMS_PROVIDER was switched to "vault". ' +
          'Re-wrap it under Vault rather than changing the provider back and forth.',
      );
    }
    const body = await this.call<TransitDecryptResponse>(`decrypt/${this.keyName}`, { ciphertext });
    const plaintext = body.data?.plaintext;
    if (!plaintext) {
      throw new VaultKmsError('Vault returned no plaintext for a decrypt call.');
    }
    return Buffer.from(plaintext, 'base64');
  }

  /**
   * Rotate the KEK. Not called by the application — it is the operator
   * action the envelope exists to make cheap, and it lives here so the suite
   * can prove the property rather than assert it in a comment.
   */
  async rotateKey(): Promise<void> {
    await this.call(`keys/${this.keyName}/rotate`, {});
  }
}

/** Exported for the suite and the simulator, which must agree on it. */
export const VAULT_CIPHERTEXT_PREFIX_RE = VAULT_CIPHERTEXT_RE;
