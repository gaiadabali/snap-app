import { FOLDER_KEYS, MailError } from "../model";
import type {
  Addr,
  Attachment,
  Draft,
  FileInput,
  Folder,
  FolderKey,
  MailClient,
  MailSummary,
  MessageDetail,
  MessageSummary,
  SafeHtml,
  UnsubscribeResult,
} from "../model";
import { assertSendable, draftFrom } from "../ops/compose";
import { htmlToText } from "../text";
import { MEMORY_ADDRESS, defaultSeeds } from "./fixtures";
import type { MemoryMessageSeed } from "./fixtures";

// An in-memory MailClient for UI work and component tests (BUILD.md T10). It follows
// the same behavioural contract as the real client; see test/contract.ts.

export type MemoryMailClient = MailClient & {
  /** Simulates mail arriving: adds the message and notifies onChange listeners. */
  deliver(seed: Partial<MemoryMessageSeed> & { subject: string }): MessageSummary;
};

interface Row extends MemoryMessageSeed {
  threadId: string;
  unsubscribed: boolean;
}

const DAILY_SEND_CAP = 100;
const NOW = "2026-11-20T03:00:00.000Z";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asAddr(v: unknown): Addr | null {
  if (!isObject(v) || typeof v["email"] !== "string" || v["email"] === "") return null;
  return typeof v["name"] === "string" && v["name"] !== "" ? { name: v["name"], email: v["email"] } : { email: v["email"] };
}

function asAddrs(v: unknown): Addr[] {
  return Array.isArray(v) ? v.map(asAddr).filter((a): a is Addr => a !== null) : [];
}

/** Lenient: a seed may give just `{ subject }`; the rest gets defaults. Non-objects are skipped. */
function normalise(raw: unknown, index: number): MemoryMessageSeed | null {
  if (!isObject(raw)) return null;
  const folder = FOLDER_KEYS.find((k) => k === raw["folder"]) ?? "inbox";
  const unsub = raw["unsubscribe"];
  const seed: MemoryMessageSeed = {
    id: typeof raw["id"] === "string" && raw["id"] !== "" ? raw["id"] : `s${index + 1}`,
    folder,
    from: asAddr(raw["from"]),
    to: asAddrs(raw["to"]),
    subject: typeof raw["subject"] === "string" ? raw["subject"] : "",
    text: typeof raw["text"] === "string" ? raw["text"] : raw["html"] ? null : "",
    receivedAt: typeof raw["receivedAt"] === "string" ? raw["receivedAt"] : NOW,
    unread: raw["unread"] === undefined ? folder === "inbox" : raw["unread"] === true,
    flagged: raw["flagged"] === true,
    unsubscribe: unsub === "one_click" || unsub === "mailto" || unsub === "link" ? unsub : null,
    bulk: raw["bulk"] === true || unsub === "one_click" || unsub === "mailto" || unsub === "link",
  };
  if (typeof raw["html"] === "string") seed.html = raw["html"];
  if (Array.isArray(raw["cc"])) seed.cc = asAddrs(raw["cc"]);
  if (Array.isArray(raw["replyTo"])) seed.replyTo = asAddrs(raw["replyTo"]);
  if (typeof raw["remoteImagesBlocked"] === "number") seed.remoteImagesBlocked = raw["remoteImagesBlocked"];
  if (typeof raw["messageId"] === "string") seed.messageId = raw["messageId"];
  if (Array.isArray(raw["references"])) seed.references = raw["references"].filter((r): r is string => typeof r === "string");
  if (typeof raw["threadId"] === "string") seed.threadId = raw["threadId"];
  if (Array.isArray(raw["attachments"])) {
    seed.attachments = raw["attachments"].flatMap((a) =>
      isObject(a) && typeof a["name"] === "string"
        ? [
            {
              name: a["name"],
              type: typeof a["type"] === "string" ? a["type"] : "application/octet-stream",
              size: typeof a["size"] === "number" ? a["size"] : 0,
              ...(a["inline"] === true ? { inline: true } : {}),
            },
          ]
        : [],
    );
  }
  return seed;
}

function previewOf(row: MemoryMessageSeed): string {
  const body = row.text ?? (row.html ? htmlToText(row.html) : "");
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}

export function createMemoryMailClient(seed?: { messages?: unknown[] }): MemoryMailClient {
  const rows = new Map<string, Row>();
  const blobs = new Map<string, { blob: Blob | null; name: string; type: string; size: number }>();
  const listeners = new Set<(what: { folders: boolean; messages: boolean }) => void>();
  let nextId = 1000;
  let nextBlob = 1;
  let sentToday = 0;
  let unsubscribedCount = 0;
  let closed = false;

  const source = seed?.messages ?? defaultSeeds();
  source.forEach((raw, i) => {
    const s = normalise(raw, i);
    if (s) rows.set(s.id, { ...s, threadId: s.threadId ?? `t-${s.id}`, unsubscribed: false });
  });

  function emit(): void {
    void Promise.resolve().then(() => {
      for (const l of [...listeners]) {
        try {
          l({ folders: true, messages: true });
        } catch {
          // ignore listener errors
        }
      }
    });
  }

  function guard<T>(run: () => T): Promise<T> {
    if (closed) return Promise.reject(new MailError("unavailable", "mail client is closed"));
    try {
      return Promise.resolve(run());
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function summaryOf(r: Row): MessageSummary {
    return {
      id: r.id,
      threadId: r.threadId,
      folder: r.folder,
      from: r.from,
      to: r.to,
      subject: r.subject,
      preview: previewOf(r),
      receivedAt: r.receivedAt,
      unread: r.unread,
      flagged: r.flagged,
      hasAttachment: (r.attachments ?? []).some((a) => a.inline !== true),
      bulk: r.bulk,
    };
  }

  function attachmentsOf(r: Row): Attachment[] {
    return (r.attachments ?? []).map((a, i) => ({
      blobId: `${r.id}-a${i + 1}`,
      name: a.name,
      type: a.type,
      size: a.size,
      inline: a.inline === true,
    }));
  }

  function detailOf(r: Row): MessageDetail {
    return {
      ...summaryOf(r),
      cc: r.cc ?? [],
      replyTo: r.replyTo ?? [],
      messageId: r.messageId ?? null,
      references: r.references ?? [],
      text: r.text,
      hasHtml: typeof r.html === "string" && r.html !== "",
      attachments: attachmentsOf(r),
      unsubscribe: r.unsubscribe,
    };
  }

  function sorted(filter: (r: Row) => boolean): Row[] {
    return [...rows.values()]
      .filter(filter)
      .sort((a, b) => (a.receivedAt === b.receivedAt ? (a.id < b.id ? 1 : -1) : a.receivedAt < b.receivedAt ? 1 : -1));
  }

  function page(all: Row[], p?: { position?: number; limit?: number }): { items: MessageSummary[]; total: number } {
    const position = Math.max(0, Math.floor(p?.position ?? 0));
    const limit = Math.min(200, Math.max(1, Math.floor(p?.limit ?? 50)));
    return { items: all.slice(position, position + limit).map(summaryOf), total: all.length };
  }

  function get(id: string): Row {
    const r = rows.get(id);
    if (!r) throw new MailError("rejected", "message not found", { status: 404 });
    return r;
  }

  function newRow(base: Partial<MemoryMessageSeed> & { subject: string }): Row {
    const id = base.id ?? `m${nextId++}`;
    const folder = base.folder ?? "inbox";
    const row: Row = {
      id,
      folder,
      from: base.from ?? null,
      to: base.to ?? [{ name: "Gee Wizduck", email: MEMORY_ADDRESS }],
      subject: base.subject,
      text: base.text === undefined ? "" : base.text,
      receivedAt: base.receivedAt ?? new Date().toISOString(),
      unread: base.unread ?? folder === "inbox",
      flagged: base.flagged ?? false,
      unsubscribe: base.unsubscribe ?? null,
      bulk: base.bulk ?? base.unsubscribe != null,
      threadId: base.threadId ?? `t-${id}`,
      unsubscribed: false,
    };
    if (base.html != null) row.html = base.html;
    if (base.cc) row.cc = base.cc;
    if (base.replyTo) row.replyTo = base.replyTo;
    if (base.attachments) row.attachments = base.attachments;
    if (base.messageId != null) row.messageId = base.messageId;
    if (base.references) row.references = base.references;
    if (base.remoteImagesBlocked != null) row.remoteImagesBlocked = base.remoteImagesBlocked;
    rows.set(id, row);
    return row;
  }

  function saveAsDraft(d: Draft, folder: FolderKey): Row {
    if (d.draftId) rows.delete(d.draftId);
    const row = newRow({
      folder,
      from: { email: MEMORY_ADDRESS },
      to: d.to,
      subject: d.subject,
      text: d.text,
      unread: false,
      bulk: false,
      attachments: (d.attachments ?? []).map((a) => ({ name: a.name, type: a.type, size: a.size })),
    });
    if (d.cc) row.cc = d.cc;
    if (d.inReplyTo) row.references = [...(d.references ?? []), d.inReplyTo];
    return row;
  }

  const client: MemoryMailClient = {
    folders: () =>
      guard(() => {
        const out: Folder[] = [];
        for (const key of FOLDER_KEYS) {
          const inFolder = [...rows.values()].filter((r) => r.folder === key);
          out.push({
            key,
            mailboxId: `mb-${key}`,
            unread: inFolder.filter((r) => r.unread).length,
            total: inFolder.length,
          });
        }
        return out;
      }),

    list: (folder, p) => guard(() => page(sorted((r) => r.folder === folder), p)),

    search: (text, p) =>
      guard(() => {
        const needle = text.trim().toLowerCase();
        if (needle === "") return { items: [], total: 0 };
        const hit = (r: Row) =>
          [r.subject, r.text ?? "", r.html ? htmlToText(r.html) : "", r.from?.email ?? "", r.from?.name ?? ""]
            .join("\n")
            .toLowerCase()
            .includes(needle);
        return page(sorted(hit), p);
      }),

    get: (id) => guard(() => detailOf(get(id))),

    safeHtml: (id) =>
      guard((): SafeHtml => {
        const r = get(id);
        if (!r.html) throw new MailError("rejected", "this message has no HTML body", { status: 404 });
        return { html: r.html, remoteImagesBlocked: r.remoteImagesBlocked ?? 0, inlineImagesDropped: 0, truncated: false };
      }),

    setRead: (ids, read) =>
      guard(() => {
        for (const id of ids) {
          const r = rows.get(id);
          if (r) r.unread = !read;
        }
        emit();
      }),

    setFlagged: (ids, flagged) =>
      guard(() => {
        for (const id of ids) {
          const r = rows.get(id);
          if (r) r.flagged = flagged;
        }
        emit();
      }),

    move: (ids, to) =>
      guard(() => {
        for (const id of ids) {
          const r = rows.get(id);
          if (r) r.folder = to;
        }
        emit();
      }),

    remove: (ids) =>
      guard(() => {
        for (const id of ids) {
          const r = rows.get(id);
          if (!r) continue;
          if (r.folder === "trash") rows.delete(id);
          else r.folder = "trash";
        }
        emit();
      }),

    upload: (file: FileInput) =>
      guard(() => {
        const blobId = `up-${nextBlob++}`;
        const type =
          (file.kind === "uri" ? file.type : file.blob.type) || "application/octet-stream";
        const size = file.kind === "blob" ? file.blob.size : 0;
        blobs.set(blobId, { blob: file.kind === "blob" ? file.blob : null, name: file.name, type, size });
        return { blobId, name: file.name, type, size, inline: false };
      }),

    download: (att) =>
      guard((): Blob | { uri: string } => {
        const stored = blobs.get(att.blobId);
        if (stored?.blob) return stored.blob;
        if (typeof Blob === "function") return new Blob([`fixture:${att.name}`], { type: att.type });
        return { uri: `memory://${att.blobId}/${encodeURIComponent(att.name)}` };
      }),

    draftFrom: (msg, mode) => draftFrom(msg, mode, MEMORY_ADDRESS),

    saveDraft: (d) =>
      guard(() => {
        const row = saveAsDraft(d, "drafts");
        emit();
        return { draftId: row.id };
      }),

    send: (d) =>
      guard(() => {
        const rcpt = assertSendable(d);
        if (sentToday + rcpt.length > DAILY_SEND_CAP) {
          throw new MailError("daily_send_cap", `at most ${DAILY_SEND_CAP} recipients a day`);
        }
        sentToday += rcpt.length;
        const row = saveAsDraft(d, "sent");
        if (rcpt.some((e) => e.toLowerCase() === MEMORY_ADDRESS)) {
          newRow({
            folder: "inbox",
            from: { email: MEMORY_ADDRESS },
            to: d.to,
            subject: d.subject,
            text: d.text,
            unread: true,
            bulk: false,
          });
        }
        emit();
        return { emailId: row.id };
      }),

    unsubscribe: (id, opts) =>
      guard((): UnsubscribeResult => {
        const r = get(id);
        if (r.unsubscribe === null) return { status: "unavailable" };
        r.unsubscribed = true;
        unsubscribedCount++;
        if (opts?.moveToJunk) r.folder = "junk";
        emit();
        if (r.unsubscribe === "link") return { status: "open_link", method: "link", url: `https://example.com/unsubscribe/${r.id}` };
        return { status: "done", method: r.unsubscribe };
      }),

    summary: (locale) =>
      guard((): MailSummary => {
        const id = (locale ?? "").toLowerCase().startsWith("id");
        return {
          address: MEMORY_ADDRESS,
          counters: {
            bulkFiled30d: [...rows.values()].filter((r) => r.folder === "junk").length,
            marketersUnsubscribed: unsubscribedCount,
            autoRepliesSent30d: 7,
          },
          banner: id
            ? {
                title: "Jangkau orang yang memang ingin mendengar dari Anda",
                body: "YourTal menampilkan merek Anda kepada audiens yang memilih untuk menonton dan mendapat imbalan.",
                ctaLabel: "Mulai beriklan",
                ctaUrl: "https://yourtal.gaiada.com/studio/onboarding",
              }
            : {
                title: "Reach people who want to hear from you",
                body: "YourTal shows your brand to an audience that opts in and is rewarded for watching.",
                ctaLabel: "Advertise on YourTal",
                ctaUrl: "https://yourtal.gaiada.com/studio/onboarding",
              },
        };
      }),

    onChange(listener) {
      if (closed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      closed = true;
      listeners.clear();
    },

    deliver(base) {
      const row = newRow(base);
      emit();
      return summaryOf(row);
    },
  };
  return client;
}
