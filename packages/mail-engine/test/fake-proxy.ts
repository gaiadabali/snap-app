/* eslint-disable @typescript-eslint/no-explicit-any */
import { defaultSeeds, MEMORY_ADDRESS } from "../src/testing/fixtures";
import type { MemoryMessageSeed } from "../src/testing/fixtures";
import type { MailSession } from "../src/model";

// A fake of the YourTal mail proxy (spambank/BUILD.md §5.3 and §4.3): a stateful
// in-memory JMAP server behind a `fetch` function, enforcing the proxy's rules
// (method allow-list, explicit envelope, 10 recipients, 100 a day, bearer token).
// It records every request so tests can assert the JMAP shapes the engine sends.

type J = Record<string, any>;

export const BASE = "https://proxy.test/api/spambank";
export const SESSION_URL = `${BASE}/jmap/session`;
export const HELPERS_BASE = `${BASE}/mail`;
export const ACCOUNT = "acct1";

const ALLOWED_METHODS = new Set([
  "Core/echo",
  "Mailbox/get", "Mailbox/changes", "Mailbox/query", "Mailbox/queryChanges",
  "Email/get", "Email/changes", "Email/query", "Email/queryChanges", "Email/set",
  "Thread/get", "Thread/changes",
  "SearchSnippet/get",
  "Identity/get",
  "EmailSubmission/get", "EmailSubmission/changes", "EmailSubmission/query", "EmailSubmission/set",
  "Quota/get",
]);

interface FakeEmail {
  id: string;
  threadId: string;
  mailboxIds: Record<string, true>;
  keywords: Record<string, true>;
  from: { name?: string; email: string }[];
  to: { name?: string; email: string }[];
  cc: { name?: string; email: string }[];
  replyTo: { name?: string; email: string }[];
  subject: string;
  text: string | null;
  html: string | null;
  receivedAt: string;
  messageId: string[] | null;
  references: string[] | null;
  attachments: { blobId: string; type: string; name: string; size: number; disposition: string }[];
  listUnsubscribe: string[] | null;
  listUnsubscribePost: string | null;
  listId: string | null;
  remoteImagesBlocked: number;
}

export interface LoggedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeProxy {
  fetch: typeof fetch;
  address: string;
  requests: LoggedRequest[];
  /** JMAP method names seen in /jmap/api requests, in order. */
  methods(): string[];
  /** The bodies of /jmap/api requests. */
  apiBodies(): J[];
  mint(ttlMs?: number): MailSession;
  /** Invalidate every token minted so far. */
  revokeAll(): void;
  /** Reject every token, even fresh ones. */
  rejectAllTokens: boolean;
  /** Make the next request fail with this status/body (once). */
  failNext(status: number, body?: J): void;
  /** Make fetch throw once (network down). */
  dropNext(): void;
  /** Respond to the event stream with a body-less response (no streaming support). */
  noStreaming: boolean;
  /** Add an inbox message as if it arrived, and push a StateChange. */
  deliver(subject: string, extra?: Partial<MemoryMessageSeed>): string;
  /** Close every open event stream from the server side. */
  closeStreams(): void;
  openStreams(): number;
  emailIdByOrdinal(ordinal: number): string;
  mailboxId(key: string): string;
  email(id: string): FakeEmail | undefined;
}

const MAILBOXES: { key: string; id: string; name: string; role: string | null }[] = [
  { key: "inbox", id: "mb-inbox", name: "Inbox", role: "inbox" },
  { key: "spam", id: "mb-spam", name: "Spam", role: "junk" },
  { key: "junk", id: "mb-junk", name: "Junk", role: null },
  { key: "sent", id: "mb-sent", name: "Sent", role: "sent" },
  { key: "drafts", id: "mb-drafts", name: "Drafts", role: "drafts" },
  { key: "trash", id: "mb-trash", name: "Trash", role: "trash" },
];

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function seedToEmail(s: MemoryMessageSeed): FakeEmail {
  let listUnsubscribe: string[] | null = null;
  let post: string | null = null;
  let listId: string | null = null;
  if (s.unsubscribe === "one_click") {
    listUnsubscribe = [`https://lists.example/u/${s.id}`, `mailto:unsub-${s.id}@lists.example`];
    post = "List-Unsubscribe=One-Click";
  } else if (s.unsubscribe === "mailto") {
    listUnsubscribe = [`mailto:unsub-${s.id}@lists.example?subject=unsubscribe`];
  } else if (s.unsubscribe === "link") {
    listUnsubscribe = [`https://lists.example/unsubscribe/${s.id}`];
  }
  if (s.bulk && listUnsubscribe === null) listId = `<list-${s.id}.lists.example>`;
  const keywords: Record<string, true> = {};
  if (!s.unread) keywords["$seen"] = true;
  if (s.flagged) keywords["$flagged"] = true;
  if (s.folder === "drafts") keywords["$draft"] = true;
  const mailbox = MAILBOXES.find((m) => m.key === s.folder);
  return {
    id: s.id,
    threadId: s.threadId ?? `t-${s.id}`,
    mailboxIds: { [mailbox?.id ?? "mb-inbox"]: true },
    keywords,
    from: s.from ? [s.from] : [],
    to: s.to,
    cc: s.cc ?? [],
    replyTo: s.replyTo ?? [],
    subject: s.subject,
    text: s.text,
    html: s.html ?? null,
    receivedAt: s.receivedAt,
    messageId: s.messageId ? [s.messageId] : null,
    references: s.references && s.references.length > 0 ? s.references : null,
    attachments: (s.attachments ?? []).map((a, i) => ({
      blobId: `${s.id}-a${i + 1}`,
      type: a.type,
      name: a.name,
      size: a.size,
      disposition: a.inline ? "inline" : "attachment",
    })),
    listUnsubscribe,
    listUnsubscribePost: post,
    listId,
    remoteImagesBlocked: s.remoteImagesBlocked ?? 0,
  };
}

function preview(e: FakeEmail): string {
  const body = e.text ?? (e.html ? e.html.replace(/<[^>]*>/g, " ") : "");
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}

function pointer(value: any, path: string): any {
  const parts = path.split("/").filter((p) => p !== "");
  let cur: any[] = [value];
  for (const part of parts) {
    const next: any[] = [];
    for (const c of cur) {
      if (part === "*") {
        if (Array.isArray(c)) next.push(...c);
      } else if (c && typeof c === "object") next.push(c[part]);
    }
    cur = next;
  }
  return parts.includes("*") ? cur : cur[0];
}

export function createFakeProxy(options?: { seeds?: MemoryMessageSeed[]; address?: string }): FakeProxy {
  const address = options?.address ?? MEMORY_ADDRESS;
  const emails = new Map<string, FakeEmail>();
  for (const s of options?.seeds ?? defaultSeeds()) emails.set(s.id, seedToEmail(s));
  const blobs = new Map<string, { bytes: Blob; type: string; name: string }>();
  const states = { email: 1, mailbox: 1 };
  const requests: LoggedRequest[] = [];
  const valid = new Set<string>();
  const streams = new Set<{ controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean }>();
  const encoder = new TextEncoder();
  let tokenCount = 0;
  let nextId = 5000;
  let sentToday = 0;
  let unsubscribed = 0;
  let pendingFail: { status: number; body: J } | null = null;
  let pendingDrop = false;

  const proxy: FakeProxy = {
    fetch: undefined as unknown as typeof fetch,
    address,
    requests,
    rejectAllTokens: false,
    noStreaming: false,
    methods: () => proxy.apiBodies().flatMap((b) => (b["methodCalls"] as any[]).map((c) => c[0] as string)),
    apiBodies: () => requests.filter((r) => r.url === `${BASE}/jmap/api` && r.body && typeof r.body === "object").map((r) => r.body as J),
    mint(ttlMs = 30 * 60 * 1000) {
      const token = `tok-${++tokenCount}`;
      valid.add(token);
      return {
        token,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        sessionUrl: SESSION_URL,
        helpersBase: HELPERS_BASE,
        address,
      };
    },
    revokeAll: () => valid.clear(),
    failNext(status, body = { code: "spambank_unavailable", message: "down" }) {
      pendingFail = { status, body };
    },
    dropNext() {
      pendingDrop = true;
    },
    deliver(subject, extra) {
      const id = `m${nextId++}`;
      const seed: MemoryMessageSeed = {
        id, folder: "inbox", from: { name: "New Sender", email: "new@example.com" }, to: [{ email: address }],
        subject, text: `Body of ${subject}`, receivedAt: new Date().toISOString(), unread: true, flagged: false,
        unsubscribe: null, bulk: false, ...extra,
      };
      emails.set(id, seedToEmail(seed));
      bump();
      return id;
    },
    closeStreams() {
      for (const s of streams) {
        if (!s.closed) {
          s.closed = true;
          try {
            s.controller.close();
          } catch {
            // already closed
          }
        }
      }
      streams.clear();
    },
    openStreams: () => [...streams].filter((s) => !s.closed).length,
    emailIdByOrdinal: (n) => `m${n}`,
    mailboxId: (key) => MAILBOXES.find((m) => m.key === key)?.id ?? "",
    email: (id) => emails.get(id),
  };

  function bump(): void {
    states.email++;
    states.mailbox++;
    const event = `event: state\ndata: ${JSON.stringify({
      "@type": "StateChange",
      changed: { [ACCOUNT]: { Email: `e${states.email}`, Mailbox: `b${states.mailbox}` } },
    })}\n\n`;
    for (const s of streams) {
      if (s.closed) continue;
      try {
        s.controller.enqueue(encoder.encode(event));
      } catch {
        s.closed = true;
      }
    }
  }

  function toJmap(e: FakeEmail, args: J): J {
    const hasAttachment = e.attachments.some((a) => a.disposition !== "inline");
    const full: J = {
      id: e.id,
      threadId: e.threadId,
      mailboxIds: e.mailboxIds,
      keywords: e.keywords,
      from: e.from,
      to: e.to,
      cc: e.cc.length > 0 ? e.cc : null,
      replyTo: e.replyTo.length > 0 ? e.replyTo : null,
      subject: e.subject,
      preview: preview(e),
      receivedAt: e.receivedAt,
      hasAttachment,
      messageId: e.messageId,
      references: e.references,
      "header:List-Unsubscribe:asURLs": e.listUnsubscribe,
      "header:List-Unsubscribe-Post:asText": e.listUnsubscribePost,
      "header:List-Id:asText": e.listId,
      "header:Precedence:asText": null,
      // RFC 8621: textBody falls back to the HTML part when there is no text/plain.
      textBody: e.text !== null ? [{ partId: "1", type: "text/plain" }] : e.html ? [{ partId: "2", type: "text/html" }] : [],
      htmlBody: e.html ? [{ partId: "2", type: "text/html" }] : e.text !== null ? [{ partId: "1", type: "text/plain" }] : [],
      attachments: e.attachments.map((a) => ({ ...a, ...(a.disposition === "inline" ? { cid: `cid-${a.blobId}` } : {}) })),
    };
    if (args["fetchTextBodyValues"] === true) {
      const values: J = {};
      if (e.text !== null) values["1"] = { value: e.text, isTruncated: false };
      if (e.html) values["2"] = { value: e.html, isTruncated: false };
      full["bodyValues"] = values;
    }
    const wanted: string[] | null = Array.isArray(args["properties"]) ? args["properties"] : null;
    if (!wanted) return full;
    const out: J = { id: e.id };
    for (const p of wanted) if (p in full) out[p] = full[p];
    return out;
  }

  function matchesText(e: FakeEmail, needle: string): boolean {
    const n = needle.toLowerCase();
    return [e.subject, e.text ?? "", e.html ? e.html.replace(/<[^>]*>/g, " ") : "", e.from[0]?.email ?? "", e.from[0]?.name ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(n);
  }

  function runMethod(name: string, args: J, creationIds: Map<string, string>): J[] {
    switch (name) {
      case "Core/echo":
        return [args];
      case "Mailbox/get": {
        const counts = (id: string) => {
          const inBox = [...emails.values()].filter((e) => e.mailboxIds[id]);
          return { total: inBox.length, unread: inBox.filter((e) => !e.keywords["$seen"]).length };
        };
        const ids: string[] | null = args["ids"] ?? null;
        const list = ids !== null && ids.length === 0
          ? []
          : MAILBOXES.map((m) => ({
              id: m.id, name: m.name, role: m.role, totalEmails: counts(m.id).total, unreadEmails: counts(m.id).unread,
            }));
        return [{ accountId: ACCOUNT, state: `b${states.mailbox}`, list, notFound: [] }];
      }
      case "Email/query": {
        const filter: J = args["filter"] ?? {};
        let rows = [...emails.values()];
        if (filter["inMailbox"]) rows = rows.filter((e) => e.mailboxIds[filter["inMailbox"]]);
        if (filter["text"]) rows = rows.filter((e) => matchesText(e, filter["text"]));
        rows.sort((a, b) => (a.receivedAt === b.receivedAt ? (a.id < b.id ? 1 : -1) : a.receivedAt < b.receivedAt ? 1 : -1));
        const position = args["position"] ?? 0;
        const limit = args["limit"] ?? 50;
        return [{
          accountId: ACCOUNT, queryState: "q1", canCalculateChanges: false, position,
          ids: rows.slice(position, position + limit).map((e) => e.id),
          ...(args["calculateTotal"] ? { total: rows.length } : {}),
        }];
      }
      case "Email/get": {
        const ids: string[] = args["ids"] ?? [];
        const list: J[] = [];
        const notFound: string[] = [];
        for (const id of ids) {
          const e = emails.get(id);
          if (e) list.push(toJmap(e, args));
          else notFound.push(id);
        }
        return [{ accountId: ACCOUNT, state: `e${states.email}`, list, notFound }];
      }
      case "SearchSnippet/get": {
        const needle: string = args["filter"]?.["text"] ?? "";
        const list = (args["emailIds"] as string[]).map((id) => {
          const e = emails.get(id);
          const body = e ? preview(e) : "";
          const at = body.toLowerCase().indexOf(needle.toLowerCase());
          const snippet = at === -1 ? body : `${body.slice(0, at)}<mark>${body.slice(at, at + needle.length)}</mark>${body.slice(at + needle.length)}`;
          return { emailId: id, subject: e?.subject ?? null, preview: snippet === "" ? null : snippet };
        });
        return [{ accountId: ACCOUNT, list, notFound: null }];
      }
      case "Email/set": {
        const created: J = {};
        const notCreated: J = {};
        const updated: J = {};
        const notUpdated: J = {};
        const destroyed: string[] = [];
        const notDestroyed: J = {};
        for (const [cid, obj] of Object.entries<J>(args["create"] ?? {})) {
          if (obj["from"]?.[0]?.email !== address || obj["from"]?.length !== 1) {
            notCreated[cid] = { type: "invalidProperties", properties: ["from"], description: "from must be the mailbox address" };
            continue;
          }
          const id = `m${nextId++}`;
          const e: FakeEmail = {
            id, threadId: `t-${id}`, mailboxIds: obj["mailboxIds"] ?? {}, keywords: obj["keywords"] ?? {},
            from: obj["from"], to: obj["to"] ?? [], cc: obj["cc"] ?? [], replyTo: [],
            subject: obj["subject"] ?? "",
            text: obj["bodyValues"]?.[obj["textBody"]?.[0]?.partId]?.value ?? "",
            html: null, receivedAt: new Date().toISOString(),
            messageId: [`<${id}@yourtal.gaiada.com>`],
            references: [...(obj["references"] ?? [])], attachments: (obj["attachments"] ?? []).map((a: J) => ({
              blobId: a["blobId"], type: a["type"], name: a["name"], size: blobs.get(a["blobId"])?.bytes.size ?? 0,
              disposition: a["disposition"] ?? "attachment",
            })),
            listUnsubscribe: null, listUnsubscribePost: null, listId: null, remoteImagesBlocked: 0,
          };
          if (obj["inReplyTo"]) e.references = [...(e.references ?? []), ...obj["inReplyTo"]];
          emails.set(id, e);
          creationIds.set(cid, id);
          created[cid] = { id, blobId: `blob-${id}`, threadId: e.threadId, size: 100 };
        }
        for (const [rawId, patch] of Object.entries<J>(args["update"] ?? {})) {
          const id = rawId.startsWith("#") ? creationIds.get(rawId.slice(1)) ?? rawId : rawId;
          const e = emails.get(id);
          if (!e) {
            notUpdated[rawId] = { type: "notFound" };
            continue;
          }
          for (const [key, value] of Object.entries(patch)) {
            if (key === "mailboxIds") e.mailboxIds = { ...value };
            else if (key.startsWith("mailboxIds/")) {
              const box = key.slice("mailboxIds/".length);
              if (value === null) delete e.mailboxIds[box];
              else e.mailboxIds[box] = true;
            } else if (key.startsWith("keywords/")) {
              const kw = key.slice("keywords/".length);
              if (value === null) delete e.keywords[kw];
              else e.keywords[kw] = true;
            }
          }
          updated[rawId] = null;
        }
        for (const id of args["destroy"] ?? []) {
          if (emails.delete(id)) destroyed.push(id);
          else notDestroyed[id] = { type: "notFound" };
        }
        bump();
        return [{
          accountId: ACCOUNT, oldState: "x", newState: `e${states.email}`,
          created: Object.keys(created).length ? created : null,
          updated: Object.keys(updated).length ? updated : null,
          destroyed: destroyed.length ? destroyed : null,
          notCreated: Object.keys(notCreated).length ? notCreated : null,
          notUpdated: Object.keys(notUpdated).length ? notUpdated : null,
          notDestroyed: Object.keys(notDestroyed).length ? notDestroyed : null,
        }];
      }
      case "Identity/get":
        return [{ accountId: ACCOUNT, state: "i1", list: [{ id: "ident-1", name: "", email: address }], notFound: [] }];
      case "EmailSubmission/set": {
        const created: J = {};
        const notCreated: J = {};
        const followUp: J[] = [];
        for (const [cid, obj] of Object.entries<J>(args["create"] ?? {})) {
          const emailId = String(obj["emailId"]).startsWith("#") ? creationIds.get(String(obj["emailId"]).slice(1)) : obj["emailId"];
          const e = emailId ? emails.get(emailId) : undefined;
          if (!e) {
            notCreated[cid] = { type: "invalidProperties", properties: ["emailId"] };
            continue;
          }
          const rcpt: string[] = (obj["envelope"]?.["rcptTo"] ?? []).map((r: J) => r["email"]);
          sentToday += rcpt.length;
          if (rcpt.some((r) => r.toLowerCase() === address.toLowerCase())) {
            const copy = seedToEmail({
              id: `m${nextId++}`, folder: "inbox", from: { email: address }, to: e.to, subject: e.subject,
              text: e.text, receivedAt: new Date().toISOString(), unread: true, flagged: false, unsubscribe: null, bulk: false,
            });
            emails.set(copy.id, copy);
          }
          creationIds.set(cid, `sub-${cid}`);
          created[cid] = { id: `sub-${cid}` };
          const onSuccess: J | undefined = args["onSuccessUpdateEmail"]?.[`#${cid}`];
          if (onSuccess) {
            followUp.push(...runMethod("Email/set", { accountId: ACCOUNT, update: { [e.id]: onSuccess } }, creationIds));
          }
        }
        bump();
        return [
          { accountId: ACCOUNT, oldState: "s0", newState: "s1", created: Object.keys(created).length ? created : null,
            notCreated: Object.keys(notCreated).length ? notCreated : null },
          ...followUp.map((f) => ({ __implicit: "Email/set", ...f })),
        ];
      }
      default:
        return [{ type: "unknownMethod" }];
    }
  }

  function handleApi(body: J): Response {
    const calls: [string, J, string][] = body["methodCalls"] ?? [];
    // Proxy rules (BUILD.md §4.3), applied to the whole request.
    for (const [name] of calls) {
      if (!ALLOWED_METHODS.has(name)) return json(400, { code: "method_not_allowed", message: `${name} is not allowed` });
    }
    let recipients = 0;
    for (const [name, args] of calls) {
      if (name !== "EmailSubmission/set") continue;
      for (const obj of Object.values<J>(args["create"] ?? {})) {
        if (!obj["envelope"]) return json(400, { code: "envelope_required", message: "envelope required" });
        const rcpt: unknown[] = obj["envelope"]["rcptTo"] ?? [];
        if (rcpt.length > 10) return json(400, { code: "too_many_recipients", message: "max 10" });
        recipients += rcpt.length;
      }
    }
    if (sentToday + recipients > 100) return json(429, { code: "daily_send_cap", message: "daily cap" });

    const results = new Map<string, [string, J]>();
    const creationIds = new Map<string, string>();
    const responses: any[] = [];
    for (const [name, rawArgs, callId] of calls) {
      const args: J = {};
      for (const [k, v] of Object.entries(rawArgs)) {
        if (k.startsWith("#")) {
          const ref = v as J;
          const prior = results.get(ref["resultOf"]);
          if (!prior || prior[0] !== ref["name"]) return json(400, { code: "bad_back_reference", message: "bad back reference" });
          args[k.slice(1)] = pointer(prior[1], ref["path"]);
        } else args[k] = v;
      }
      const [first, ...rest] = runMethod(name, args, creationIds);
      if (first && first["type"] === "unknownMethod") {
        responses.push(["error", { type: "unknownMethod" }, callId]);
        continue;
      }
      results.set(callId, [name, first ?? {}]);
      responses.push([name, first, callId]);
      for (const extra of rest) {
        const { __implicit, ...r } = extra;
        responses.push([__implicit, r, callId]);
      }
    }
    return json(200, { methodResponses: responses, sessionState: "ss1" });
  }

  function summaryJson(locale: string | null): J {
    const id = locale?.toLowerCase().startsWith("id") ?? false;
    return {
      address,
      folders: { spamMailboxId: "mb-spam", junkMailboxId: "mb-junk" },
      counters: {
        bulkFiled30d: [...emails.values()].filter((e) => e.mailboxIds["mb-junk"]).length,
        marketersUnsubscribed: unsubscribed,
        autoRepliesSent30d: 7,
      },
      banner: id
        ? { title: "Jangkau orang yang memang ingin mendengar dari Anda", body: "Isi", ctaLabel: "Mulai beriklan", ctaUrl: "https://yourtal.gaiada.com/studio/onboarding" }
        : { title: "Reach people who want to hear from you", body: "Body", ctaLabel: "Advertise on YourTal", ctaUrl: "https://yourtal.gaiada.com/studio/onboarding" },
    };
  }

  async function route(url: string, init: RequestInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.replace(BASE, "");
    const [pathname, query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    const p = pathname ?? "";

    if (p === "/jmap/session") {
      return json(200, {
        capabilities: { "urn:ietf:params:jmap:core": {}, "urn:ietf:params:jmap:mail": {}, "urn:ietf:params:jmap:submission": {} },
        accounts: { [ACCOUNT]: { name: address, isPersonal: true } },
        primaryAccounts: { "urn:ietf:params:jmap:mail": ACCOUNT, "urn:ietf:params:jmap:submission": ACCOUNT },
        username: address,
        apiUrl: `${BASE}/jmap/api`,
        downloadUrl: `${BASE}/jmap/download/{accountId}/{blobId}/{name}?accept={type}`,
        uploadUrl: `${BASE}/jmap/upload/{accountId}/`,
        eventSourceUrl: `${BASE}/jmap/eventsource?types={types}&closeafter={closeafter}&ping={ping}`,
        state: "ss1",
      });
    }
    if (p === "/jmap/api" && method === "POST") return handleApi(JSON.parse(String(init.body)));
    if (p.startsWith("/jmap/upload/") && method === "POST") {
      const blob = init.body as Blob;
      const blobId = `up-${nextId++}`;
      blobs.set(blobId, { bytes: blob, type: new Headers(init.headers).get("content-type") ?? "", name: "" });
      return json(201, { accountId: ACCOUNT, blobId, type: new Headers(init.headers).get("content-type"), size: blob.size });
    }
    if (p.startsWith("/jmap/download/")) {
      const [, , , , blobId = "", name = ""] = p.split("/");
      const stored = blobs.get(blobId);
      const content = stored ? stored.bytes : new Blob([`fixture:${decodeURIComponent(name)}`]);
      return new Response(content, { status: 200, headers: { "Content-Type": params.get("accept") ?? "application/octet-stream" } });
    }
    if (p === "/jmap/eventsource") {
      if (proxy.noStreaming) return new Response(null, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      let entry!: { controller: ReadableStreamDefaultController<Uint8Array>; closed: boolean };
      const drop = () => {
        entry.closed = true;
        streams.delete(entry);
      };
      // Like a real fetch: aborting the request tears the stream down.
      init.signal?.addEventListener("abort", () => {
        drop();
        try {
          entry.controller.error(new DOMException("aborted", "AbortError"));
        } catch {
          // already closed
        }
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          entry = { controller, closed: false };
          streams.add(entry);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          drop();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (p === "/mail/summary") return json(200, summaryJson(params.get("locale")));
    const safe = /^\/mail\/messages\/([^/]+)\/safe-html$/.exec(p);
    if (safe) {
      const e = emails.get(decodeURIComponent(safe[1] ?? ""));
      if (!e || !e.html) return json(404, { code: "not_found", message: "no html body" });
      return json(200, { html: e.html, remoteImagesBlocked: e.remoteImagesBlocked, inlineImagesDropped: 0, truncated: false });
    }
    const unsub = /^\/mail\/messages\/([^/]+)\/unsubscribe$/.exec(p);
    if (unsub && method === "POST") {
      const e = emails.get(decodeURIComponent(unsub[1] ?? ""));
      if (!e) return json(404, { code: "not_found", message: "no such message" });
      const body: J = init.body ? JSON.parse(String(init.body)) : {};
      const urls = e.listUnsubscribe ?? [];
      if (urls.length === 0) return json(200, { status: "unavailable" });
      e.keywords["$spambank_unsubscribed"] = true;
      unsubscribed++;
      if (body["moveToJunk"]) e.mailboxIds = { "mb-junk": true };
      bump();
      const https = urls.find((u) => u.startsWith("https://"));
      if (https && e.listUnsubscribePost) return json(200, { status: "done", method: "one_click" });
      if (urls.some((u) => u.startsWith("mailto:"))) return json(200, { status: "done", method: "mailto" });
      return json(200, { status: "open_link", method: "link", url: https });
    }
    return json(404, { code: "not_found", message: `no route for ${method} ${p}` });
  }

  proxy.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = init?.body ?? null;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // keep as text
      }
    }
    requests.push({ method: (init?.method ?? "GET").toUpperCase(), url, headers, body });
    if (pendingDrop) {
      pendingDrop = false;
      throw new TypeError("fetch failed");
    }
    if (pendingFail) {
      const f = pendingFail;
      pendingFail = null;
      return json(f.status, f.body);
    }
    const auth = headers["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (proxy.rejectAllTokens || !valid.has(token)) return json(401, { code: "unauthorized", message: "bad token" });
    return route(url, init ?? {});
  }) as typeof fetch;

  return proxy;
}
