import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { config } from './config.js';

/**
 * Signed, self-describing tokens.
 *
 * Two kinds, one mechanism: a session token says who you are, an upload token
 * says which capture a set of bytes may be written to. Both are bearer
 * credentials and both are verified without a database round trip.
 *
 * Format: `base64url(payload).base64url(hmac)`. Not a JWT, deliberately —
 * JWT's algorithm field has produced a decade of `alg: none` and confused-key
 * vulnerabilities, and none of its flexibility is wanted here. One algorithm,
 * one key, no negotiation.
 */

type Payload = {
  /** What the token authorises. */
  k: 'session' | 'upload' | 'download' | 'image';
  /** Subject: a user id for a session, a capture id for an upload or an image. */
  s: string;
  /** Tenant, for an upload — so a token cannot be replayed into another. */
  t?: string;
  /**
   * 1-based page number, for an upload token.
   *
   * A capture is now `pages[]`, not one blob, and each page gets its own PUT
   * URL — so the token has to say which of the declared pages these bytes
   * belong to. Without it, `PUT /v1/uploads/:token` would have nowhere to
   * park a page other than "always page 1", which is exactly the bug this
   * contract exists to fix.
   *
   * Reused for an image token with a different convention: `0` means "the
   * capture's original bytes" (what `captures.original_storage_key` points
   * at — the same thing `DocumentView.imageUrl` has always meant), and `1..n`
   * means that entry in `capture_pages` (what `DocumentView.pages[].imageUrl`
   * has always meant). Two kinds, one field, because an image token is never
   * read by `readUploadToken` or vice versa — `k` keeps them apart the same
   * way it keeps a session token from being read as an upload token.
   */
  p?: number;
  /**
   * How many pages the capture DECLARED, for an upload token.
   *
   * `PUT /v1/uploads/:token` has to know when the last of them has arrived so
   * it can enqueue extraction exactly once — never once per page — and it has
   * no other cheap way to ask "how many are there meant to be" without a
   * database round trip per upload. Carried in the token instead, since it
   * was already known and fixed at `POST /v1/captures` time.
   */
  c?: number;
  /** Expiry, epoch seconds. Absent for a session, which does not expire here. */
  e?: number;
  /** Nonce, so two tokens for the same subject differ. */
  n: string;
};

const b64url = (b: Buffer): string => b.toString('base64url');

function sign(data: string): string {
  return b64url(createHmac('sha256', config().TOKEN_SECRET).update(data).digest());
}

function encode(payload: Payload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body)}`;
}

function decode(token: string): Payload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(body);

  // Constant-time: a fast reject on the first wrong byte leaks the signature
  // one byte at a time to anyone willing to time the responses.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (payload.e != null && payload.e < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ── Sessions ────────────────────────────────────────────────────────────── */

export function issueSession(userId: string): string {
  return encode({ k: 'session', s: userId, n: randomUUID() });
}

/** The user id a session token names, or null if it is not a valid one. */
export function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const payload = decode(token);
  // The kind is checked, not assumed: without it an upload token would be
  // accepted as a session for whatever id it happens to carry.
  return payload && payload.k === 'session' ? payload.s : null;
}

/* ── Uploads ─────────────────────────────────────────────────────────────── */

export function issueUploadToken(
  captureId: string,
  tenantId: string,
  pageNumber: number,
  pageCount: number,
): string {
  return encode({
    k: 'upload',
    s: captureId,
    t: tenantId,
    p: pageNumber,
    c: pageCount,
    e: Math.floor(Date.now() / 1000) + config().UPLOAD_TTL_SECONDS,
    n: randomUUID(),
  });
}

export function readUploadToken(
  token: string | undefined,
): { captureId: string; tenantId: string; pageNumber: number; pageCount: number } | null {
  if (!token) return null;
  const payload = decode(token);
  // `p`/`c` absent would mean a token minted before pages existed, or a
  // forged one — either way there is no declared page to attribute these
  // bytes to, so it fails the same way an expired token does (see the
  // comment at the call site: expired and forged must stay indistinguishable).
  if (
    !payload ||
    payload.k !== 'upload' ||
    !payload.t ||
    typeof payload.p !== 'number' ||
    typeof payload.c !== 'number'
  ) {
    return null;
  }
  return { captureId: payload.s, tenantId: payload.t, pageNumber: payload.p, pageCount: payload.c };
}

/* ── Downloads ───────────────────────────────────────────────────────────── */

/**
 * A short-lived link to an assembled export.
 *
 * A separate kind from an upload token for the same reason `readSession`
 * checks `k`: the two are structurally identical and a download token that
 * could be replayed as an upload token would let anyone holding a link
 * overwrite the capture it names.
 *
 * Ten minutes. Long enough to hand to a browser, short enough that a link
 * pasted into a chat has stopped working by the time anyone reads it.
 */
export function issueDownloadToken(key: string, tenantId: string): string {
  return encode({
    k: 'download',
    s: key,
    t: tenantId,
    e: Math.floor(Date.now() / 1000) + 600,
    n: randomUUID(),
  });
}

export function readDownloadToken(
  token: string | undefined,
): { key: string; tenantId: string } | null {
  if (!token) return null;
  const payload = decode(token);
  if (!payload || payload.k !== 'download' || !payload.t) return null;
  return { key: payload.s, tenantId: payload.t };
}

/* ── Images ──────────────────────────────────────────────────────────────── */

/**
 * A short-lived link to one page's bytes (or a capture's original), for
 * `GET /v1/images/:token` — `docs/contracts/phase0-multipage.md` §8.
 *
 * Exists because `DocumentView.imageUrl` and `pages[].imageUrl` are read by
 * `<Image source={{uri}}>`, which cannot attach an `Authorization` header —
 * on web `react-native-web` renders a plain `<img>`, which cannot either. A
 * signed URL sidesteps the problem the same way `/v1/uploads/:token` and
 * `/v1/downloads/:token` already do: the token IS the credential, so no
 * client-side auth plumbing is needed to load an image.
 *
 * Minted fresh on every `GET /v1/documents/:id` (and list), never stored in a
 * column — a stored token would outlive its usefulness the moment the TTL
 * making it safe to hand to an `<img>` tag became a lie.
 */
export function issueImageToken(captureId: string, tenantId: string, pageNumber: number): string {
  return encode({
    k: 'image',
    s: captureId,
    t: tenantId,
    p: pageNumber,
    e: Math.floor(Date.now() / 1000) + config().IMAGE_TTL_SECONDS,
    n: randomUUID(),
  });
}

export function readImageToken(
  token: string | undefined,
): { captureId: string; tenantId: string; pageNumber: number } | null {
  if (!token) return null;
  const payload = decode(token);
  // Same shape-check discipline as `readUploadToken`: a token minted before
  // `p` existed, or a hand-forged one missing it, fails exactly like an
  // expired token — nothing here distinguishes the two to the caller.
  if (!payload || payload.k !== 'image' || !payload.t || typeof payload.p !== 'number') {
    return null;
  }
  return { captureId: payload.s, tenantId: payload.t, pageNumber: payload.p };
}
