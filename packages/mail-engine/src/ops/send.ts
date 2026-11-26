import { MailError } from "../model";
import type { Attachment, Draft, FileInput } from "../model";
import { assertSet, expandTemplate, isRecord, readJson } from "../jmap/transport";
import type { Transport } from "../jmap/transport";
import { assertSendable, draftEmailObject } from "./compose";
import type { FolderService } from "./folders";

// Drafts, sending and file transfer.

export interface SendOps {
  saveDraft(d: Draft): Promise<{ draftId: string }>;
  send(d: Draft): Promise<{ emailId: string }>;
  upload(file: FileInput): Promise<Attachment>;
  download(att: Attachment): Promise<Blob | { uri: string }>;
}

export interface SendOptions {
  fetch?: typeof fetch | undefined;
  downloadToUri?: ((url: string, headers: Record<string, string>, name: string) => Promise<{ uri: string }>) | undefined;
}

function createdId(result: Record<string, unknown>, creationId: string): string {
  const created = result["created"];
  const row = isRecord(created) ? created[creationId] : undefined;
  const id = isRecord(row) ? row["id"] : undefined;
  if (typeof id !== "string" || id === "") throw new MailError("unavailable", "the server did not return an id");
  return id;
}

export function createSendOps(transport: Transport, folders: FolderService, options: SendOptions): SendOps {
  let identity: Promise<string> | null = null;

  /** The identity to send as: the one matching the mailbox address, else the first (U7). */
  function identityId(address: string): Promise<string> {
    if (!identity) {
      const p = (async () => {
        const js = await transport.jmap();
        const res = await transport.call([
          ["Identity/get", { accountId: js.accountId, ids: null, properties: ["id", "email"] }, "i"],
        ]);
        const list = res.get("i")["list"];
        const rows = Array.isArray(list) ? list.filter(isRecord) : [];
        const own = rows.find((r) => typeof r["email"] === "string" && r["email"].toLowerCase() === address.toLowerCase());
        const chosen = own ?? rows[0];
        const id = chosen ? chosen["id"] : undefined;
        if (typeof id !== "string") throw new MailError("rejected", "this mailbox has no sending identity");
        return id;
      })();
      identity = p;
      p.catch(() => {
        if (identity === p) identity = null;
      });
    }
    return identity;
  }

  async function draftsId(): Promise<string> {
    const id = (await folders.index()).idOf("drafts");
    if (!id) throw new MailError("rejected", "this mailbox has no drafts folder");
    return id;
  }

  return {
    async saveDraft(d) {
      const s = await transport.session();
      const js = await transport.jmap();
      const drafts = await draftsId();
      const args: Record<string, unknown> = {
        accountId: js.accountId,
        create: { draft: draftEmailObject(d, s.address, drafts, true) },
      };
      // Emails are immutable: an edited draft replaces the old one in the same call.
      if (d.draftId) args["destroy"] = [d.draftId];
      const res = await transport.call([["Email/set", args, "e"]]);
      const result = res.get("e");
      assertSet(result, ["notCreated", "notDestroyed"]);
      return { draftId: createdId(result, "draft") };
    },

    async send(d) {
      const rcpt = assertSendable(d);
      const s = await transport.session();
      const js = await transport.jmap();
      const idx = await folders.index();
      const drafts = idx.idOf("drafts");
      const sent = idx.idOf("sent");
      if (!drafts || !sent) throw new MailError("rejected", "this mailbox has no drafts or sent folder");
      const identityIdValue = await identityId(s.address);

      const emailArgs: Record<string, unknown> = {
        accountId: js.accountId,
        create: { draft: draftEmailObject(d, s.address, drafts, true) },
      };
      if (d.draftId) emailArgs["destroy"] = [d.draftId];

      const res = await transport.call([
        ["Email/set", emailArgs, "e"],
        [
          "EmailSubmission/set",
          {
            accountId: js.accountId,
            create: {
              sub: {
                identityId: identityIdValue,
                emailId: "#draft",
                // Always explicit: the proxy refuses a submission without an envelope.
                envelope: {
                  mailFrom: { email: s.address },
                  rcptTo: rcpt.map((email) => ({ email })),
                },
              },
            },
            onSuccessUpdateEmail: {
              "#sub": {
                "keywords/$draft": null,
                [`mailboxIds/${drafts}`]: null,
                [`mailboxIds/${sent}`]: true,
              },
            },
          },
          "s",
        ],
      ]);
      const created = res.get("e", "Email/set");
      assertSet(created, ["notCreated", "notDestroyed"]);
      assertSet(res.get("s", "EmailSubmission/set"), ["notCreated"]);
      return { emailId: createdId(created, "draft") };
    },

    async upload(file) {
      const js = await transport.jmap();
      let blob: Blob;
      let name: string;
      if (file.kind === "blob") {
        blob = file.blob;
        name = file.name;
      } else {
        // React Native: read the picked file through fetch, then upload the bytes.
        const doFetch: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
        try {
          blob = await (await doFetch(file.uri)).blob();
        } catch (cause) {
          throw new MailError("rejected", "could not read the file", { cause });
        }
        name = file.name;
      }
      const type = (file.kind === "uri" ? file.type : blob.type) || "application/octet-stream";
      const res = await transport.request(expandTemplate(js.uploadUrl, { accountId: js.accountId }), {
        method: "POST",
        headers: { "Content-Type": type },
        body: blob,
      });
      const json = await readJson(res);
      const blobId = isRecord(json) ? json["blobId"] : undefined;
      if (typeof blobId !== "string" || blobId === "") throw new MailError("unavailable", "malformed upload response");
      const size = isRecord(json) && typeof json["size"] === "number" ? json["size"] : blob.size;
      return { blobId, name, type, size, inline: false };
    },

    async download(att) {
      const js = await transport.jmap();
      const url = expandTemplate(js.downloadUrl, {
        accountId: js.accountId,
        blobId: att.blobId,
        name: att.name,
        type: att.type,
        accept: att.type,
      });
      if (options.downloadToUri) {
        // Native: the headers carry the token, so it never ends up in a URL.
        return options.downloadToUri(url, await transport.authHeaders(), att.name);
      }
      const res = await transport.request(url);
      return res.blob();
    },
  };
}
