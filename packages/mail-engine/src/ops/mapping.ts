import type { Addr, Attachment, FolderKey, MessageDetail, MessageSummary } from "../model";
import { isRecord } from "../jmap/transport";

// JMAP Email JSON -> the engine's model types.

export const SUMMARY_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "from",
  "to",
  "subject",
  "preview",
  "receivedAt",
  "hasAttachment",
  "header:List-Unsubscribe:asURLs",
  "header:List-Id:asText",
  "header:Precedence:asText",
];

export const DETAIL_PROPERTIES = [
  ...SUMMARY_PROPERTIES,
  "cc",
  "replyTo",
  "messageId",
  "references",
  "textBody",
  "htmlBody",
  "attachments",
  "bodyValues",
  "header:List-Unsubscribe-Post:asText",
];

/** Largest body value requested per part. */
export const MAX_BODY_VALUE_BYTES = 512 * 1024;

export type FolderLookup = (mailboxId: string) => FolderKey | null;

const FOLDER_ORDER: readonly FolderKey[] = ["inbox", "spam", "junk", "sent", "drafts", "trash"];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function toAddr(v: unknown): Addr | null {
  if (!isRecord(v)) return null;
  const email = str(v["email"]).trim();
  if (email === "") return null;
  const name = str(v["name"]).trim();
  return name === "" ? { email } : { name, email };
}

export function toAddrs(v: unknown): Addr[] {
  if (!Array.isArray(v)) return [];
  const out: Addr[] = [];
  for (const a of v) {
    const addr = toAddr(a);
    if (addr) out.push(addr);
  }
  return out;
}

function folderOf(mailboxIds: unknown, lookup: FolderLookup): FolderKey | null {
  if (!isRecord(mailboxIds)) return null;
  const found = new Set<FolderKey>();
  for (const id of Object.keys(mailboxIds)) {
    const key = lookup(id);
    if (key) found.add(key);
  }
  return FOLDER_ORDER.find((k) => found.has(k)) ?? null;
}

/** Bulk mail: `List-Unsubscribe`, `List-Id` or `Precedence: bulk|list|junk` (BUILD.md B7). */
export function isBulk(e: Record<string, unknown>): boolean {
  const unsub = e["header:List-Unsubscribe:asURLs"];
  if (Array.isArray(unsub) && unsub.length > 0) return true;
  if (str(e["header:List-Id:asText"]).trim() !== "") return true;
  return ["bulk", "list", "junk"].includes(str(e["header:Precedence:asText"]).trim().toLowerCase());
}

export function toSummary(e: Record<string, unknown>, lookup: FolderLookup): MessageSummary {
  const keywords = isRecord(e["keywords"]) ? e["keywords"] : {};
  const from = Array.isArray(e["from"]) ? toAddr(e["from"][0]) : null;
  return {
    id: str(e["id"]),
    threadId: str(e["threadId"]),
    folder: folderOf(e["mailboxIds"], lookup),
    from,
    to: toAddrs(e["to"]),
    subject: str(e["subject"]),
    preview: str(e["preview"]),
    receivedAt: str(e["receivedAt"]),
    unread: keywords["$seen"] !== true,
    flagged: keywords["$flagged"] === true,
    hasAttachment: e["hasAttachment"] === true,
    bulk: isBulk(e),
  };
}

function unsubscribeKind(e: Record<string, unknown>): MessageDetail["unsubscribe"] {
  const urls = strArray(e["header:List-Unsubscribe:asURLs"]);
  if (urls.length === 0) return null;
  const https = urls.some((u) => /^https:\/\//i.test(u));
  const post = str(e["header:List-Unsubscribe-Post:asText"]).toLowerCase().replace(/\s+/g, "");
  // Same order the server applies (BUILD.md §4.5): one-click, then mailto, then a plain link.
  if (https && post.includes("list-unsubscribe=one-click")) return "one_click";
  if (urls.some((u) => /^mailto:/i.test(u))) return "mailto";
  if (urls.some((u) => /^https?:\/\//i.test(u))) return "link";
  return null;
}

function toAttachment(v: unknown): Attachment | null {
  if (!isRecord(v)) return null;
  const blobId = str(v["blobId"]);
  if (blobId === "") return null;
  const name = str(v["name"]);
  return {
    blobId,
    name: name === "" ? "attachment" : name,
    type: str(v["type"]) || "application/octet-stream",
    size: typeof v["size"] === "number" ? v["size"] : 0,
    inline: str(v["disposition"]).toLowerCase() === "inline" || str(v["cid"]) !== "",
  };
}

function bodyText(e: Record<string, unknown>): { text: string | null; hasHtml: boolean } {
  const values = isRecord(e["bodyValues"]) ? e["bodyValues"] : {};
  const parts = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);
  // `textBody` falls back to the HTML part when a message has no text/plain
  // alternative, so keep only real text/plain parts: HTML is shown via safeHtml().
  const plain = parts(e["textBody"]).filter((p) => str(p["type"]).toLowerCase() === "text/plain");
  const chunks: string[] = [];
  for (const p of plain) {
    const value = values[str(p["partId"])];
    if (isRecord(value) && typeof value["value"] === "string") chunks.push(value["value"]);
  }
  const hasHtml = parts(e["htmlBody"]).some((p) => str(p["type"]).toLowerCase() === "text/html");
  return { text: chunks.length > 0 ? chunks.join("\n") : null, hasHtml };
}

export function toDetail(e: Record<string, unknown>, lookup: FolderLookup): MessageDetail {
  const base = toSummary(e, lookup);
  const { text, hasHtml } = bodyText(e);
  const attachments: Attachment[] = [];
  if (Array.isArray(e["attachments"])) {
    for (const a of e["attachments"]) {
      const att = toAttachment(a);
      if (att) attachments.push(att);
    }
  }
  const messageIds = strArray(e["messageId"]);
  return {
    ...base,
    cc: toAddrs(e["cc"]),
    replyTo: toAddrs(e["replyTo"]),
    messageId: messageIds[0] ?? null,
    references: strArray(e["references"]),
    text,
    hasHtml,
    attachments,
    unsubscribe: unsubscribeKind(e),
  };
}
