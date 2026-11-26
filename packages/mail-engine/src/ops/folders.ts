import { FOLDER_KEYS } from "../model";
import type { Folder, FolderKey } from "../model";
import { isRecord } from "../jmap/transport";
import type { Transport } from "../jmap/transport";
import type { Helpers } from "./helpers";

// Folder resolution (BUILD.md B7). "Spam" is the `junk`-role mailbox; "Junk" is a
// custom mailbox whose id the proxy reports in `/summary` (`folders.junkMailboxId`),
// with a name fallback for when the server could not rename the role mailbox.

export interface FolderIndex {
  idOf(key: FolderKey): string | undefined;
  keyOf(mailboxId: string): FolderKey | null;
}

export interface FolderService {
  /** Cached ids, loaded on first use. Mailbox ids never change; counts do. */
  index(): Promise<FolderIndex>;
  /** Fresh counts for every folder the account has. */
  list(): Promise<Folder[]>;
}

interface RawMailbox {
  id: string;
  name: string;
  role: string | null;
  total: number;
  unread: number;
}

interface Built {
  index: FolderIndex;
  ids: Map<FolderKey, string>;
}

function parseMailboxes(list: unknown): RawMailbox[] {
  if (!Array.isArray(list)) return [];
  const out: RawMailbox[] = [];
  for (const m of list) {
    if (!isRecord(m) || typeof m["id"] !== "string") continue;
    out.push({
      id: m["id"],
      name: typeof m["name"] === "string" ? m["name"] : "",
      role: typeof m["role"] === "string" ? m["role"].toLowerCase() : null,
      total: typeof m["totalEmails"] === "number" ? m["totalEmails"] : 0,
      unread: typeof m["unreadEmails"] === "number" ? m["unreadEmails"] : 0,
    });
  }
  return out;
}

function buildIndex(
  mailboxes: RawMailbox[],
  hint: { spamMailboxId: string | null; junkMailboxId: string | null },
): Built {
  const ids = new Map<FolderKey, string>();
  const roles: Record<string, FolderKey> = {
    inbox: "inbox",
    sent: "sent",
    drafts: "drafts",
    trash: "trash",
    junk: "spam",
  };
  for (const m of mailboxes) {
    const key = m.role ? roles[m.role] : undefined;
    if (key && !ids.has(key)) ids.set(key, m.id);
  }
  const exists = (id: string | null): id is string => id !== null && mailboxes.some((m) => m.id === id);
  if (exists(hint.spamMailboxId) && !ids.has("spam")) ids.set("spam", hint.spamMailboxId);
  if (exists(hint.junkMailboxId)) {
    ids.set("junk", hint.junkMailboxId);
  } else {
    const named = mailboxes.find((m) => m.role === null && /^(junk|promotions)$/i.test(m.name.trim()));
    if (named) ids.set("junk", named.id);
  }
  const byId = new Map<string, FolderKey>();
  for (const [key, id] of ids) byId.set(id, key);
  return {
    ids,
    index: {
      idOf: (key) => ids.get(key),
      keyOf: (id) => byId.get(id) ?? null,
    },
  };
}

export function createFolderService(transport: Transport, helpers: Helpers): FolderService {
  let cached: Promise<Built> | null = null;

  async function fetchMailboxes(): Promise<RawMailbox[]> {
    const js = await transport.jmap();
    const res = await transport.call([
      [
        "Mailbox/get",
        { accountId: js.accountId, ids: null, properties: ["id", "name", "role", "totalEmails", "unreadEmails"] },
        "m",
      ],
    ]);
    return parseMailboxes(res.get("m")["list"]);
  }

  function load(): Promise<Built> {
    if (!cached) {
      const p = (async () => {
        const [mailboxes, folders] = await Promise.all([
          fetchMailboxes(),
          // A failed summary only costs the Junk id hint; the name fallback covers it.
          helpers.summary().then(
            (s) => s.folders,
            () => ({ spamMailboxId: null, junkMailboxId: null }),
          ),
        ]);
        return buildIndex(mailboxes, folders);
      })();
      cached = p;
      p.catch(() => {
        if (cached === p) cached = null;
      });
    }
    return cached;
  }

  return {
    async index() {
      return (await load()).index;
    },
    async list() {
      const { ids } = await load();
      const mailboxes = await fetchMailboxes();
      const out: Folder[] = [];
      for (const key of FOLDER_KEYS) {
        const id = ids.get(key);
        const m = id === undefined ? undefined : mailboxes.find((x) => x.id === id);
        if (m) out.push({ key, mailboxId: m.id, unread: m.unread, total: m.total });
      }
      return out;
    },
  };
}
