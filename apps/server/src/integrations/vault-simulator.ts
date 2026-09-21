import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A simulated Vault, and the emphasis is on *simulated* rather than *faked*.
 *
 * `docs/INTEGRATIONS.md` ticket K2, and the distinction its §0 draws:
 *
 *   A stub would implement `KmsProvider` directly and return the DEK it was
 *   given. Every test would pass and `VaultTransitKmsProvider` — the code
 *   that will actually run in production — would never execute a single
 *   line.
 *
 *   This is an HTTP server that speaks Vault's Transit API. The real
 *   provider makes real `fetch` calls against it, parses real JSON, handles
 *   real HTTP status codes, and fails on a real 403. The only thing that is
 *   not real is where the key material lives.
 *
 * So what is under test is the client, which is the part that ships.
 *
 * ── What it implements, and why each one is needed ────────────────────────
 *
 *   POST /v1/{mount}/encrypt/{key}    the wrap path
 *   POST /v1/{mount}/decrypt/{key}    the unwrap path
 *   POST /v1/{mount}/keys/{key}/rotate  a NEW key version
 *
 * The third is the one that justifies the whole envelope design and is
 * almost never exercised against a real KMS before it matters. Here it is
 * one call, so `kms.test.ts` can prove the property the file header claims:
 * rotating the KEK does not require re-encrypting anything already wrapped.
 *
 * ── Fidelity, deliberately, in the places that bite ───────────────────────
 *
 *  * **Versioned ciphertext.** Every ciphertext is `vault:vN:<base64>`, and
 *    N really is the key version that wrapped it. Decrypt selects the key by
 *    the version in the prefix, exactly as Vault does, and retains old
 *    versions. A simulator emitting bare base64 would let a rotation bug
 *    ship.
 *  * **Token auth.** A wrong or missing `X-Vault-Token` gets a real 403 with
 *    Vault's `{"errors":["permission denied"]}` body, because "the token
 *    expired" is the most likely production failure of this integration and
 *    the client's handling of it should not be theoretical.
 *  * **Vault's error shape.** `{"errors": [...]}` with the right status, so
 *    the client's error parsing is the code being tested.
 *  * **An unknown key is 400**, not 500 — Vault does not create keys on
 *    decrypt.
 *
 * ── What it does NOT pretend to be ────────────────────────────────────────
 *
 * Not a security boundary. The "KEK" is a random buffer in this process's
 * memory and dies with it. It is not hardware-backed, not access-logged, and
 * not a place to put a real credential — which is precisely why
 * `integrations/simulation.ts` refuses to select it on a production host
 * that has not declared itself a demo, and why `encryptApiKey` keeps its
 * production refusal for anything that is not a real provider.
 */

const IV_LEN = 12;
const TAG_LEN = 16;

export interface VaultSimulator {
  /** e.g. `http://127.0.0.1:53124` — pass straight to `VAULT_ADDR`. */
  readonly address: string;
  /** The token the simulator will accept. Anything else gets a real 403. */
  readonly token: string;
  /** The current key version, as Vault would report it. */
  readonly version: () => number;
  /** Mint a new key version, retaining the old ones. */
  readonly rotate: () => number;
  readonly close: () => Promise<void>;
}

export interface VaultSimulatorOptions {
  token?: string;
  mount?: string;
  keyName?: string;
}

/**
 * Starts the simulator on an ephemeral port.
 *
 * Ephemeral rather than fixed: these suites run in parallel, and a fixed
 * port makes two of them fail intermittently in a way that reads as a flaky
 * test rather than as a port collision.
 */
export async function startVaultSimulator(
  options: VaultSimulatorOptions = {},
): Promise<VaultSimulator> {
  const token = options.token ?? `s.sim-${randomBytes(8).toString('hex')}`;
  const mount = options.mount ?? 'transit';
  const keyName = options.keyName ?? 'snap-dek';

  /** version -> key material. Old versions are RETAINED, as Vault retains them. */
  const keys = new Map<number, Buffer>();
  let currentVersion = 1;
  keys.set(currentVersion, randomBytes(32));

  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
    };
    const vaultError = (status: number, ...errors: string[]): void => send(status, { errors });

    if (req.method !== 'POST') {
      return vaultError(405, 'unsupported operation');
    }

    // Vault authenticates every request. A missing or wrong token is 403
    // with this exact body — the client's most likely production failure.
    if (req.headers['x-vault-token'] !== token) {
      return vaultError(403, 'permission denied');
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return vaultError(400, 'failed to parse JSON input');
        }
      }

      const path = (req.url ?? '').split('?')[0]!;
      const base = `/v1/${mount}`;

      if (path === `${base}/encrypt/${keyName}`) {
        const plaintext = body.plaintext;
        if (typeof plaintext !== 'string') {
          return vaultError(400, "missing required parameter 'plaintext'");
        }
        let dek: Buffer;
        try {
          dek = Buffer.from(plaintext, 'base64');
        } catch {
          return vaultError(400, 'failed to base64-decode plaintext');
        }
        const key = keys.get(currentVersion)!;
        const iv = randomBytes(IV_LEN);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
        const sealed = Buffer.concat([iv, cipher.getAuthTag(), ct]);
        return send(200, {
          data: { ciphertext: `vault:v${currentVersion}:${sealed.toString('base64')}` },
        });
      }

      if (path === `${base}/decrypt/${keyName}`) {
        const ciphertext = body.ciphertext;
        if (typeof ciphertext !== 'string') {
          return vaultError(400, "missing required parameter 'ciphertext'");
        }
        const match = /^vault:v(\d+):(.*)$/.exec(ciphertext);
        if (!match) {
          return vaultError(400, 'invalid ciphertext: no prefix');
        }
        const version = Number(match[1]);
        const key = keys.get(version);
        if (!key) {
          // Vault's message when a ciphertext names a version that has been
          // discarded by min_decryption_version.
          return vaultError(400, 'ciphertext or context was invalid');
        }
        let recovered: Buffer;
        try {
          const sealed = Buffer.from(match[2]!, 'base64');
          const iv = sealed.subarray(0, IV_LEN);
          const tag = sealed.subarray(IV_LEN, IV_LEN + TAG_LEN);
          const payload = sealed.subarray(IV_LEN + TAG_LEN);
          const decipher = createDecipheriv('aes-256-gcm', key, iv);
          decipher.setAuthTag(tag);
          recovered = Buffer.concat([decipher.update(payload), decipher.final()]);
        } catch {
          return vaultError(400, 'ciphertext or context was invalid');
        }
        return send(200, { data: { plaintext: recovered.toString('base64') } });
      }

      if (path === `${base}/keys/${keyName}/rotate`) {
        currentVersion += 1;
        keys.set(currentVersion, randomBytes(32));
        return send(200, { data: { latest_version: currentVersion } });
      }

      // Vault answers 404 with an empty errors array for an unknown path.
      return send(404, { errors: [] });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    address: `http://127.0.0.1:${port}`,
    token,
    version: () => currentVersion,
    rotate: () => {
      currentVersion += 1;
      keys.set(currentVersion, randomBytes(32));
      return currentVersion;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
