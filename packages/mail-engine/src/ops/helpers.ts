import { MailError } from "../model";
import type { MailSummary, SafeHtml, UnsubscribeResult } from "../model";
import { isRecord, readJson } from "../jmap/transport";
import type { Transport } from "../jmap/transport";

// The proxy's non-JMAP routes under `helpersBase` (BUILD.md §5.3):
// summary, safe-html and unsubscribe.

export interface SummaryFolders {
  spamMailboxId: string | null;
  junkMailboxId: string | null;
}

export interface RawSummary {
  summary: MailSummary;
  folders: SummaryFolders;
}

export interface Helpers {
  summary(locale?: string): Promise<RawSummary>;
  safeHtml(id: string): Promise<SafeHtml>;
  unsubscribe(id: string, opts?: { moveToJunk?: boolean }): Promise<UnsubscribeResult>;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function createHelpers(transport: Transport): Helpers {
  async function base(): Promise<string> {
    const s = await transport.session();
    return s.helpersBase.replace(/\/+$/, "");
  }

  return {
    async summary(locale) {
      const query = locale ? `?locale=${encodeURIComponent(locale)}` : "";
      const res = await transport.request(`${await base()}/summary${query}`, {
        headers: { Accept: "application/json" },
      });
      const json = await readJson(res);
      if (!isRecord(json)) throw new MailError("unavailable", "malformed summary");
      const counters = isRecord(json["counters"]) ? json["counters"] : {};
      const folders = isRecord(json["folders"]) ? json["folders"] : {};
      const banner = isRecord(json["banner"]) ? json["banner"] : null;
      const summary: MailSummary = {
        address: text(json["address"]) || (transport.peek()?.address ?? ""),
        counters: {
          bulkFiled30d: num(counters["bulkFiled30d"]),
          marketersUnsubscribed: num(counters["marketersUnsubscribed"]),
          autoRepliesSent30d: num(counters["autoRepliesSent30d"]),
        },
        banner:
          banner && text(banner["title"]) !== ""
            ? {
                title: text(banner["title"]),
                body: text(banner["body"]),
                ctaLabel: text(banner["ctaLabel"]),
                ctaUrl: text(banner["ctaUrl"]),
              }
            : null,
      };
      return {
        summary,
        folders: {
          spamMailboxId: text(folders["spamMailboxId"]) || null,
          junkMailboxId: text(folders["junkMailboxId"]) || null,
        },
      };
    },

    async safeHtml(id) {
      const res = await transport.request(`${await base()}/messages/${encodeURIComponent(id)}/safe-html`, {
        headers: { Accept: "application/json" },
      });
      const json = await readJson(res);
      if (!isRecord(json) || typeof json["html"] !== "string") {
        throw new MailError("unavailable", "malformed safe-html response");
      }
      return {
        html: json["html"],
        remoteImagesBlocked: num(json["remoteImagesBlocked"]),
        inlineImagesDropped: num(json["inlineImagesDropped"]),
        truncated: json["truncated"] === true,
      };
    },

    async unsubscribe(id, opts) {
      const body = opts?.moveToJunk ? { moveToJunk: true } : {};
      const res = await transport.request(`${await base()}/messages/${encodeURIComponent(id)}/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      return parseUnsubscribe(await readJson(res));
    },
  };
}

export function parseUnsubscribe(json: unknown): UnsubscribeResult {
  if (!isRecord(json)) return { status: "failed" };
  const status = json["status"];
  const method = json["method"];
  if (status === "done" && (method === "one_click" || method === "mailto")) {
    return { status: "done", method };
  }
  if (status === "open_link") {
    const url = json["url"];
    if (typeof url === "string" && /^https?:\/\//i.test(url)) return { status: "open_link", method: "link", url };
    return { status: "failed" };
  }
  if (status === "unavailable") return { status: "unavailable" };
  return { status: "failed" };
}
