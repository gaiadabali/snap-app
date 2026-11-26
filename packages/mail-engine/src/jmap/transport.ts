import { MailError } from "../model";
import type { MailErrorCode, MailSession } from "../model";

// Authenticated transport to the YourTal mail proxy (spambank/BUILD.md §5.3):
// a 30-minute mail token as `Authorization: Bearer`, refreshed two minutes
// before expiry or once on a 401, JMAP over POST, helper routes over fetch.

export type Invocation = [name: string, args: Record<string, unknown>, callId: string];

export const MAIL_CAPABILITY = "urn:ietf:params:jmap:mail";
export const USING = [
  "urn:ietf:params:jmap:core",
  MAIL_CAPABILITY,
  "urn:ietf:params:jmap:submission",
];

/** Refresh the mail token this long before it expires. */
export const REFRESH_LEAD_MS = 2 * 60 * 1000;
/** Used when the session's `expiresAt` cannot be parsed. */
const FALLBACK_TTL_MS = 25 * 60 * 1000;

export interface JmapSession {
  apiUrl: string;
  downloadUrl: string;
  uploadUrl: string;
  eventSourceUrl: string;
  accountId: string;
}

export interface Results {
  /**
   * Arguments of the response to `callId` (optionally the one named `name`: an
   * EmailSubmission/set with onSuccessUpdateEmail answers with two responses under
   * one call id). Throws a MailError for a JMAP method error.
   */
  get(callId: string, name?: string): Record<string, unknown>;
  /** Like get(), but undefined when there is no such response. A method error still throws. */
  find(callId: string, name: string): Record<string, unknown> | undefined;
}

export interface RequestInitLite {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  signal?: AbortSignal;
}

export interface Transport {
  /** The most recent session (address, helpersBase), or null before the first mint. */
  peek(): MailSession | null;
  /** A session whose token is not about to expire. */
  session(): Promise<MailSession>;
  jmap(): Promise<JmapSession>;
  /** Authenticated fetch with one refresh-and-retry on 401; non-2xx becomes a MailError. */
  request(url: string, init?: RequestInitLite): Promise<Response>;
  call(calls: Invocation[]): Promise<Results>;
  /** Headers for a request made outside this transport (native file download). */
  authHeaders(): Promise<Record<string, string>>;
  close(): void;
}

export interface TransportOptions {
  getSession: () => Promise<MailSession>;
  fetch?: typeof fetch | undefined;
  now?: () => number;
}

export function createTransport(options: TransportOptions): Transport {
  const now = options.now ?? (() => Date.now());
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  let closed = false;
  let current: MailSession | null = null;
  let expiresMs = 0;
  let pending: Promise<MailSession> | null = null;
  let jmapPromise: Promise<JmapSession> | null = null;

  function refresh(): Promise<MailSession> {
    if (pending) return pending;
    const run = (async () => {
      let next: MailSession;
      try {
        next = await options.getSession();
      } catch (cause) {
        if (cause instanceof MailError) throw cause;
        throw new MailError("unavailable", "could not get a mail session", { cause });
      }
      if (
        !next ||
        typeof next.token !== "string" ||
        next.token === "" ||
        typeof next.sessionUrl !== "string" ||
        typeof next.helpersBase !== "string"
      ) {
        throw new MailError("unavailable", "invalid mail session");
      }
      const parsed = Date.parse(next.expiresAt);
      current = next;
      expiresMs = Number.isNaN(parsed) ? now() + FALLBACK_TTL_MS : parsed;
      return next;
    })();
    pending = run;
    const clear = () => {
      if (pending === run) pending = null;
    };
    run.then(clear, clear);
    return run;
  }

  async function session(): Promise<MailSession> {
    if (closed) throw new MailError("unavailable", "mail client is closed");
    if (current && now() < expiresMs - REFRESH_LEAD_MS) return current;
    return refresh();
  }

  async function request(url: string, init?: RequestInitLite): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const s = await session();
      let res: Response;
      try {
        const headers = { ...(init?.headers ?? {}), Authorization: `Bearer ${s.token}` };
        const req: RequestInit = { ...init, headers };
        res = await doFetch(url, req);
      } catch (cause) {
        throw new MailError("network", "network error", { cause });
      }
      if (res.status === 401 && attempt === 0) {
        // Token rejected (revoked or clock skew): mint a new one and retry once.
        current = null;
        continue;
      }
      if (!res.ok) throw await errorFromResponse(res);
      return res;
    }
  }

  function loadJmap(): Promise<JmapSession> {
    if (!jmapPromise) {
      const p = (async () => {
        const s = await session();
        const res = await request(s.sessionUrl, { headers: { Accept: "application/json" } });
        return parseJmapSession(await readJson(res), s.sessionUrl);
      })();
      jmapPromise = p;
      p.catch(() => {
        if (jmapPromise === p) jmapPromise = null;
      });
    }
    return jmapPromise;
  }

  async function call(calls: Invocation[]): Promise<Results> {
    const js = await loadJmap();
    const res = await request(js.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ using: USING, methodCalls: calls }),
    });
    const json = await readJson(res);
    const responses = isRecord(json) ? json["methodResponses"] : undefined;
    if (!Array.isArray(responses)) throw new MailError("unavailable", "malformed JMAP response");
    const byId = new Map<string, [string, Record<string, unknown>][]>();
    for (const r of responses) {
      if (Array.isArray(r) && typeof r[0] === "string" && isRecord(r[1]) && typeof r[2] === "string") {
        const list = byId.get(r[2]) ?? [];
        list.push([r[0], r[1]]);
        byId.set(r[2], list);
      }
    }
    const pick = (callId: string, name?: string): Record<string, unknown> | undefined => {
      const list = byId.get(callId) ?? [];
      // A method error answers the whole call, whatever name was asked for.
      const failed = list.find((h) => h[0] === "error");
      if (failed) throw methodError(failed[1]);
      return list.find((h) => name === undefined || h[0] === name)?.[1];
    };
    return {
      get(callId, name) {
        const hit = pick(callId, name);
        if (!hit) throw new MailError("unavailable", `missing JMAP result "${callId}"`);
        return hit;
      },
      find: (callId, name) => pick(callId, name),
    };
  }

  return {
    peek: () => current,
    session,
    jmap: loadJmap,
    request,
    call,
    async authHeaders() {
      const s = await session();
      return { Authorization: `Bearer ${s.token}` };
    },
    close() {
      closed = true;
    },
  };
}

// ---- helpers ---------------------------------------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (cause) {
    throw new MailError("unavailable", "response was not JSON", { cause });
  }
}

function resolveUrl(u: unknown, base: string): string | null {
  if (typeof u !== "string" || u === "") return null;
  if (/^https?:\/\//i.test(u)) return u;
  const origin = /^(https?:\/\/[^/]+)/i.exec(base)?.[1];
  if (origin && u.startsWith("/")) return origin + u;
  return null;
}

function parseJmapSession(json: unknown, sessionUrl: string): JmapSession {
  if (!isRecord(json)) throw new MailError("unavailable", "malformed JMAP session");
  const apiUrl = resolveUrl(json["apiUrl"], sessionUrl);
  const downloadUrl = resolveUrl(json["downloadUrl"], sessionUrl);
  const uploadUrl = resolveUrl(json["uploadUrl"], sessionUrl);
  const eventSourceUrl = resolveUrl(json["eventSourceUrl"], sessionUrl);
  const primary = isRecord(json["primaryAccounts"]) ? json["primaryAccounts"][MAIL_CAPABILITY] : undefined;
  const accounts = isRecord(json["accounts"]) ? Object.keys(json["accounts"]) : [];
  const accountId = typeof primary === "string" ? primary : accounts[0];
  if (!apiUrl || !downloadUrl || !uploadUrl || !accountId) {
    throw new MailError("unavailable", "JMAP session is missing required fields");
  }
  return { apiUrl, downloadUrl, uploadUrl, eventSourceUrl: eventSourceUrl ?? "", accountId };
}

/** RFC 6570 simple expansion of `{name}` placeholders, percent-encoding each value. */
export function expandTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => encodeURIComponent(vars[name] ?? ""));
}

async function errorFromResponse(res: Response): Promise<MailError> {
  let code = "";
  let message = "";
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      if (typeof body["code"] === "string") code = body["code"];
      if (typeof body["message"] === "string") message = body["message"];
      else if (typeof body["detail"] === "string") message = body["detail"];
    }
  } catch {
    // no JSON body; the status alone decides
  }
  return mapHttpError(res.status, code, message);
}

/** Maps a proxy error (`{code, message}` with an HTTP status) to a MailError. */
export function mapHttpError(status: number, code: string, message: string): MailError {
  const text = message || code || `HTTP ${status}`;
  let mapped: MailErrorCode;
  if (code === "daily_send_cap") mapped = "daily_send_cap";
  else if (code === "too_many_recipients") mapped = "too_many_recipients";
  else if (status === 401 || code === "unauthorized") mapped = "unauthorized";
  else if (code === "not_enabled") mapped = "not_enabled";
  else if (status === 429 || code === "rate_limited") mapped = "rate_limited";
  else if (status >= 500 || code === "spambank_unavailable" || code === "upstream_auth") mapped = "unavailable";
  else mapped = "rejected";
  return new MailError(mapped, text, { status });
}

function methodError(args: Record<string, unknown>): MailError {
  const type = typeof args["type"] === "string" ? args["type"] : "serverFail";
  const description = typeof args["description"] === "string" ? `: ${args["description"]}` : "";
  let code: MailErrorCode;
  if (type === "rateLimit") code = "rate_limited";
  else if (type === "serverUnavailable" || type === "serverFail" || type === "serverPartialFail") code = "unavailable";
  else code = "rejected";
  return new MailError(code, `JMAP ${type}${description}`);
}

/** Throws a MailError when a JMAP `/set` response reports a failed create, update or destroy. */
export function assertSet(result: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const failed = result[key];
    if (!isRecord(failed)) continue;
    for (const [id, err] of Object.entries(failed)) {
      const type = isRecord(err) && typeof err["type"] === "string" ? err["type"] : "failed";
      const description = isRecord(err) && typeof err["description"] === "string" ? `: ${err["description"]}` : "";
      const code: MailErrorCode =
        type === "tooManyRecipients" ? "too_many_recipients" : type === "rateLimit" ? "rate_limited" : "rejected";
      throw new MailError(code, `${key} ${id}: ${type}${description}`);
    }
  }
}
