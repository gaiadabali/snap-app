import { MailError } from "../model";
import type { FolderKey, MessageDetail, MessageSummary, Page } from "../model";
import { assertSet, isRecord } from "../jmap/transport";
import type { Transport } from "../jmap/transport";
import type { FolderService } from "./folders";
import { DETAIL_PROPERTIES, MAX_BODY_VALUE_BYTES, SUMMARY_PROPERTIES, toDetail, toSummary } from "./mapping";
import { snippetToText } from "../text";

// Reading and changing messages: list, search, get, flags, move, remove
// (BUILD.md §7, "Clients"). Every method here is on the proxy's allow-list (§4.3).

export const DEFAULT_PAGE_SIZE = 50;

export interface MessageOps {
  list(folder: FolderKey, page?: Page): Promise<{ items: MessageSummary[]; total: number }>;
  search(text: string, page?: Page): Promise<{ items: MessageSummary[]; total: number }>;
  get(id: string): Promise<MessageDetail>;
  setRead(ids: string[], read: boolean): Promise<void>;
  setFlagged(ids: string[], flagged: boolean): Promise<void>;
  move(ids: string[], to: FolderKey): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

function records(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function clampPage(page?: Page): { position: number; limit: number } {
  const position = Math.max(0, Math.floor(page?.position ?? 0));
  const limit = Math.min(200, Math.max(1, Math.floor(page?.limit ?? DEFAULT_PAGE_SIZE)));
  return { position, limit };
}

export function createMessageOps(transport: Transport, folders: FolderService): MessageOps {
  /** Rows come back in any order; put them in the order the query returned. */
  function inOrder(order: string[], rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of rows) if (typeof r["id"] === "string") byId.set(r["id"], r);
    const out: Record<string, unknown>[] = [];
    for (const id of order) {
      const row = byId.get(id);
      if (row) out.push(row);
    }
    return out;
  }

  async function query(
    filter: Record<string, unknown>,
    page: Page | undefined,
    snippets: string | null,
  ): Promise<{ items: MessageSummary[]; total: number }> {
    const idx = await folders.index();
    const js = await transport.jmap();
    const { position, limit } = clampPage(page);
    const calls: Parameters<Transport["call"]>[0] = [
      [
        "Email/query",
        {
          accountId: js.accountId,
          filter,
          sort: [{ property: "receivedAt", isAscending: false }],
          position,
          limit,
          calculateTotal: true,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId: js.accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: SUMMARY_PROPERTIES,
        },
        "g",
      ],
    ];
    if (snippets !== null) {
      calls.push([
        "SearchSnippet/get",
        {
          accountId: js.accountId,
          filter: { text: snippets },
          "#emailIds": { resultOf: "q", name: "Email/query", path: "/ids" },
        },
        "s",
      ]);
    }
    const res = await transport.call(calls);
    const q = res.get("q");
    const order = ids(q["ids"]);
    const rows = inOrder(order, records(res.get("g")["list"]));
    const found = new Map<string, string>();
    if (snippets !== null) {
      for (const s of records(res.get("s")["list"])) {
        const emailId = s["emailId"];
        const preview = s["preview"];
        if (typeof emailId === "string" && typeof preview === "string" && preview !== "") {
          found.set(emailId, snippetToText(preview));
        }
      }
    }
    const items = rows.map((row) => {
      const item = toSummary(row, (id) => idx.keyOf(id));
      const snippet = found.get(item.id);
      return snippet === undefined ? item : { ...item, preview: snippet };
    });
    const total = typeof q["total"] === "number" ? q["total"] : position + items.length;
    return { items, total };
  }

  async function setKeyword(idList: string[], keyword: string, on: boolean): Promise<void> {
    if (idList.length === 0) return;
    const js = await transport.jmap();
    const update: Record<string, Record<string, unknown>> = {};
    for (const id of idList) update[id] = { [`keywords/${keyword}`]: on ? true : null };
    const res = await transport.call([["Email/set", { accountId: js.accountId, update }, "u"]]);
    assertSet(res.get("u"), ["notUpdated"]);
  }

  async function currentState(idList: string[]): Promise<Record<string, unknown>[]> {
    const js = await transport.jmap();
    const res = await transport.call([
      ["Email/get", { accountId: js.accountId, ids: idList, properties: ["id", "mailboxIds", "keywords"] }, "c"],
    ]);
    return records(res.get("c")["list"]);
  }

  return {
    async list(folder, page) {
      const idx = await folders.index();
      const mailboxId = idx.idOf(folder);
      if (!mailboxId) return { items: [], total: 0 };
      return query({ inMailbox: mailboxId }, page, null);
    },

    async search(text, page) {
      const needle = text.trim();
      if (needle === "") return { items: [], total: 0 };
      return query({ text: needle }, page, needle);
    },

    async get(id) {
      const idx = await folders.index();
      const js = await transport.jmap();
      const res = await transport.call([
        [
          "Email/get",
          {
            accountId: js.accountId,
            ids: [id],
            properties: DETAIL_PROPERTIES,
            fetchTextBodyValues: true,
            maxBodyValueBytes: MAX_BODY_VALUE_BYTES,
          },
          "g",
        ],
      ]);
      const row = records(res.get("g")["list"])[0];
      if (!row) throw new MailError("rejected", "message not found", { status: 404 });
      return toDetail(row, (mailboxId) => idx.keyOf(mailboxId));
    },

    setRead: (idList, read) => setKeyword(idList, "$seen", read),
    setFlagged: (idList, flagged) => setKeyword(idList, "$flagged", flagged),

    async move(idList, to) {
      if (idList.length === 0) return;
      const idx = await folders.index();
      const target = idx.idOf(to);
      if (!target) throw new MailError("rejected", `this mailbox has no ${to} folder`);
      const spamId = idx.idOf("spam");
      const js = await transport.jmap();
      const update: Record<string, Record<string, unknown>> = {};
      for (const email of await currentState(idList)) {
        const id = email["id"];
        if (typeof id !== "string") continue;
        const boxes = isRecord(email["mailboxIds"]) ? email["mailboxIds"] : {};
        const wasSpam = spamId !== undefined && boxes[spamId] === true;
        const patch: Record<string, unknown> = { mailboxIds: { [target]: true } };
        if (to === "spam" && !wasSpam) {
          // Training signal for the spam filter.
          patch["keywords/$junk"] = true;
          patch["keywords/$notjunk"] = null;
        } else if (to !== "spam" && wasSpam) {
          patch["keywords/$notjunk"] = true;
          patch["keywords/$junk"] = null;
        }
        update[id] = patch;
      }
      if (Object.keys(update).length === 0) return;
      const res = await transport.call([["Email/set", { accountId: js.accountId, update }, "u"]]);
      assertSet(res.get("u"), ["notUpdated"]);
    },

    async remove(idList) {
      if (idList.length === 0) return;
      const idx = await folders.index();
      const trash = idx.idOf("trash");
      if (!trash) throw new MailError("rejected", "this mailbox has no trash folder");
      const js = await transport.jmap();
      const update: Record<string, Record<string, unknown>> = {};
      const destroy: string[] = [];
      for (const email of await currentState(idList)) {
        const id = email["id"];
        if (typeof id !== "string") continue;
        const boxes = isRecord(email["mailboxIds"]) ? email["mailboxIds"] : {};
        if (boxes[trash] === true) destroy.push(id);
        else update[id] = { mailboxIds: { [trash]: true } };
      }
      if (destroy.length === 0 && Object.keys(update).length === 0) return;
      const args: Record<string, unknown> = { accountId: js.accountId };
      if (Object.keys(update).length > 0) args["update"] = update;
      if (destroy.length > 0) args["destroy"] = destroy;
      const res = await transport.call([["Email/set", args, "u"]]);
      assertSet(res.get("u"), ["notUpdated", "notDestroyed"]);
    },
  };
}
