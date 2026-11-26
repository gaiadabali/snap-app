import { describe, expect, it } from "vitest";
import { MailError } from "../src/model";
import type { Draft, MailClient } from "../src/model";
import { MEMORY_ADDRESS } from "../src/testing/fixtures";

/**
 * The behavioural contract of a MailClient. It runs against the REAL client
 * (talking to the fake proxy) and against the in-memory client, on the same
 * fixtures, so the in-memory client cannot drift from what the engine really does.
 */
export interface ContractSubject {
  client: MailClient;
  /** Make a new inbox message arrive from outside, as if delivered by the server. */
  deliver(subject: string): void;
  dispose(): void;
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function failure(p: Promise<unknown>): Promise<MailError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof MailError) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

export function describeMailContract(name: string, make: () => Promise<ContractSubject>): void {
  describe(`MailClient contract: ${name}`, () => {
    async function subject(): Promise<ContractSubject> {
      const s = await make();
      // The real client learns the mailbox address from its first call.
      await s.client.folders();
      return s;
    }

    it("lists the six folders with unread and total counts", async () => {
      const { client, dispose } = await subject();
      const folders = await client.folders();
      expect(folders.map((f) => f.key)).toEqual(["inbox", "spam", "junk", "sent", "drafts", "trash"]);
      expect(new Set(folders.map((f) => f.mailboxId)).size).toBe(6);
      const by = Object.fromEntries(folders.map((f) => [f.key, f]));
      expect([by["inbox"]?.total, by["inbox"]?.unread]).toEqual([8, 3]);
      expect([by["spam"]?.total, by["spam"]?.unread]).toEqual([3, 2]);
      expect([by["junk"]?.total, by["junk"]?.unread]).toEqual([4, 2]);
      expect([by["sent"]?.total, by["drafts"]?.total, by["trash"]?.total]).toEqual([2, 1, 2]);
      dispose();
    });

    it("lists a folder newest first with summary fields", async () => {
      const { client, dispose } = await subject();
      const { items, total } = await client.list("inbox");
      expect(total).toBe(8);
      expect(items.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
      const m2 = items[1];
      expect(m2).toMatchObject({
        id: "m2",
        folder: "inbox",
        subject: "Your 2025-26 tax return checklist",
        from: { name: "Anika Rao", email: "anika@rao-accounting.example" },
        unread: true,
        flagged: false,
        hasAttachment: true,
        bulk: false,
      });
      expect(m2?.preview).toContain("checklist");
      expect(new Date(m2?.receivedAt ?? "").getTime()).toBeGreaterThan(0);
      const junk = await client.list("junk");
      expect(junk.items.every((m) => m.bulk && m.folder === "junk")).toBe(true);
      expect(items.find((m) => m.id === "m5")?.flagged).toBe(true);
      dispose();
    });

    it("pages with position and limit", async () => {
      const { client, dispose } = await subject();
      const ids = async (position: number) =>
        (await client.list("inbox", { position, limit: 3 })).items.map((m) => m.id);
      expect(await ids(0)).toEqual(["m1", "m2", "m3"]);
      expect(await ids(3)).toEqual(["m4", "m5", "m6"]);
      expect(await ids(6)).toEqual(["m7", "m8"]);
      expect((await client.list("inbox", { position: 3, limit: 3 })).total).toBe(8);
      dispose();
    });

    it("searches across folders, newest first, and returns nothing for an empty query", async () => {
      const { client, dispose } = await subject();
      expect((await client.search("invoice")).items.map((m) => m.id)).toEqual(["m5"]);
      const lunch = await client.search("lunch");
      expect(lunch.items.map((m) => m.id)).toEqual(["m16", "m1"]);
      expect(lunch.total).toBe(2);
      expect((await client.search("   ")).items).toEqual([]);
      expect((await client.search("zzzz-no-such-word")).total).toBe(0);
      dispose();
    });

    it("gets a message with body, headers, attachments and the unsubscribe kind", async () => {
      const { client, dispose } = await subject();
      const m2 = await client.get("m2");
      expect(m2.text).toContain("checklist");
      expect(m2.hasHtml).toBe(true);
      expect(m2.replyTo).toEqual([{ name: "Rao Accounting", email: "reception@rao-accounting.example" }]);
      expect(m2.messageId).toBe("<m2@rao-accounting.example>");
      expect(m2.attachments).toEqual([
        { blobId: expect.any(String), name: "checklist.pdf", type: "application/pdf", size: 183422, inline: false },
      ]);

      const m4 = await client.get("m4");
      expect(m4.to).toHaveLength(2);
      expect(m4.cc).toEqual([{ name: "Priya", email: "priya@example.org" }]);
      expect(m4.references).toEqual(["<m0@example.org>"]);

      const htmlOnly = await client.get("m6");
      expect(htmlOnly.text).toBeNull();
      expect(htmlOnly.hasHtml).toBe(true);

      const m7 = await client.get("m7");
      expect(m7.attachments.map((a) => [a.name, a.inline])).toEqual([
        ["sunset.jpg", false],
        ["beach.jpg", false],
        ["logo.png", true],
      ]);

      expect((await client.get("m12")).unsubscribe).toBe("one_click");
      expect((await client.get("m13")).unsubscribe).toBe("mailto");
      expect((await client.get("m14")).unsubscribe).toBe("link");
      expect((await client.get("m15")).unsubscribe).toBeNull();
      expect((await client.get("m1")).unsubscribe).toBeNull();

      expect((await failure(client.get("nope"))).code).toBe("rejected");
      dispose();
    });

    it("returns sanitised HTML with the blocked-image count, and fails for a text-only message", async () => {
      const { client, dispose } = await subject();
      const safe = await client.safeHtml("m12");
      expect(safe.html).toContain("<table");
      expect(safe.remoteImagesBlocked).toBe(4);
      expect(safe.truncated).toBe(false);
      expect((await failure(client.safeHtml("m1"))).code).toBe("rejected");
      dispose();
    });

    it("marks read and flagged, and keeps folder counts in step", async () => {
      const { client, dispose } = await subject();
      await client.setRead(["m1", "m2"], true);
      expect((await client.get("m1")).unread).toBe(false);
      expect((await client.folders()).find((f) => f.key === "inbox")?.unread).toBe(1);
      await client.setRead(["m1"], false);
      expect((await client.get("m1")).unread).toBe(true);
      await client.setFlagged(["m1"], true);
      expect((await client.get("m1")).flagged).toBe(true);
      await client.setFlagged(["m1"], false);
      expect((await client.get("m1")).flagged).toBe(false);
      dispose();
    });

    it("moves messages between folders, including into and out of Spam", async () => {
      const { client, dispose } = await subject();
      await client.move(["m1"], "spam");
      expect((await client.get("m1")).folder).toBe("spam");
      expect((await client.list("spam")).total).toBe(4);
      expect((await client.list("inbox")).total).toBe(7);
      await client.move(["m1"], "inbox");
      expect((await client.get("m1")).folder).toBe("inbox");
      await client.move(["m9"], "junk");
      expect((await client.list("junk")).total).toBe(5);
      dispose();
    });

    it("removes to Trash, and destroys what is already in Trash", async () => {
      const { client, dispose } = await subject();
      await client.remove(["m8"]);
      expect((await client.get("m8")).folder).toBe("trash");
      expect((await client.list("trash")).total).toBe(3);
      await client.remove(["m8", "m19"]);
      expect((await client.list("trash")).total).toBe(1);
      expect((await failure(client.get("m8"))).code).toBe("rejected");
      dispose();
    });

    it("drafts replies, reply-all and forwards", async () => {
      const { client, dispose } = await subject();
      const m2 = await client.get("m2");
      const reply = client.draftFrom(m2, "reply");
      expect(reply.to).toEqual([{ name: "Rao Accounting", email: "reception@rao-accounting.example" }]);
      expect(reply.subject).toBe("Re: Your 2025-26 tax return checklist");
      expect(reply.inReplyTo).toBe("<m2@rao-accounting.example>");
      expect(reply.references).toEqual(["<m2@rao-accounting.example>"]);
      expect(reply.text.startsWith("\n\nOn ")).toBe(true);
      expect(reply.text).toContain("> Hello,");

      const m4 = await client.get("m4");
      const all = client.draftFrom(m4, "replyAll");
      expect(all.to.map((a) => a.email)).toEqual(["dev@example.org", "lee@example.org"]);
      expect(all.cc?.map((a) => a.email)).toEqual(["priya@example.org"]);
      expect(all.subject).toBe("Re: Quote for the deck");
      expect(all.references).toEqual(["<m0@example.org>", "<m4@example.org>"]);

      const fwd = client.draftFrom(m2, "forward");
      expect(fwd.to).toEqual([]);
      expect(fwd.subject).toBe("Fwd: Your 2025-26 tax return checklist");
      expect(fwd.text).toContain("Forwarded message");
      expect(fwd.attachments?.map((a) => a.name)).toEqual(["checklist.pdf"]);
      expect(fwd.inReplyTo).toBeUndefined();
      dispose();
    });

    it("saves a draft, replacing the previous version when saved again", async () => {
      const { client, dispose } = await subject();
      const first = await client.saveDraft({ to: [{ email: "a@example.com" }], subject: "Draft one", text: "v1" });
      expect((await client.list("drafts")).total).toBe(2);
      const second = await client.saveDraft({
        draftId: first.draftId,
        to: [{ email: "a@example.com" }],
        subject: "Draft one",
        text: "v2",
      });
      expect(second.draftId).not.toBe("");
      const drafts = await client.list("drafts");
      expect(drafts.total).toBe(2);
      expect(drafts.items.map((m) => m.id)).toContain(second.draftId);
      expect(drafts.items.map((m) => m.id)).not.toContain(first.draftId);
      dispose();
    });

    it("sends: lands in Sent, leaves Drafts, and delivers to itself when addressed to itself", async () => {
      const { client, dispose } = await subject();
      const sentBefore = (await client.list("sent")).total;
      const out = await client.send({ to: [{ email: "maria@example.com" }], subject: "Hello Maria", text: "Hi" });
      expect(out.emailId).not.toBe("");
      const sent = await client.list("sent");
      expect(sent.total).toBe(sentBefore + 1);
      expect(sent.items[0]?.subject).toBe("Hello Maria");
      expect(sent.items[0]?.folder).toBe("sent");

      // A saved draft is consumed by sending it.
      const draft = await client.saveDraft({ to: [{ email: "b@example.com" }], subject: "Soon", text: "x" });
      expect((await client.list("drafts")).total).toBe(2);
      await client.send({ draftId: draft.draftId, to: [{ email: "b@example.com" }], subject: "Soon", text: "x" });
      expect((await client.list("drafts")).total).toBe(1);

      await client.send({ to: [{ email: MEMORY_ADDRESS }], subject: "Note to self", text: "remember" });
      expect((await client.search("Note to self")).items.some((m) => m.folder === "inbox")).toBe(true);
      dispose();
    });

    it("refuses sends with no recipient, too many recipients, or past the daily cap", async () => {
      const { client, dispose } = await subject();
      const draft = (n: number): Draft => ({
        to: Array.from({ length: n }, (_v, i) => ({ email: `r${i}-${n}@example.com` })),
        subject: "bulk",
        text: "x",
      });
      expect((await failure(client.send(draft(0)))).code).toBe("rejected");
      expect((await failure(client.send(draft(11)))).code).toBe("too_many_recipients");
      for (let i = 0; i < 10; i++) {
        await client.send({ ...draft(10), subject: `batch ${i}`, to: draft(10).to.map((a) => ({ email: `${i}${a.email}` })) });
      }
      expect((await failure(client.send(draft(1)))).code).toBe("daily_send_cap");
      dispose();
    });

    it("uploads, attaches and downloads files", async () => {
      const { client, dispose } = await subject();
      const att = await client.upload({ kind: "blob", blob: new Blob(["hello"], { type: "text/plain" }), name: "a.txt" });
      expect(att).toMatchObject({ name: "a.txt", type: "text/plain", size: 5, inline: false });
      expect(att.blobId).not.toBe("");
      const back = await client.download(att);
      expect(back instanceof Blob).toBe(true);
      expect(await (back as Blob).text()).toBe("hello");

      const fixture = (await client.get("m2")).attachments[0];
      const dl = (await client.download(fixture!)) as Blob;
      expect(await dl.text()).toBe("fixture:checklist.pdf");

      await client.send({ to: [{ email: "c@example.com" }], subject: "With file", text: "see attached", attachments: [att] });
      const sent = (await client.list("sent")).items[0];
      expect(sent?.subject).toBe("With file");
      expect(sent?.hasAttachment).toBe(true);
      dispose();
    });

    it("unsubscribes by one-click, mailto or link, and reports the counter", async () => {
      const { client, dispose } = await subject();
      expect(await client.unsubscribe("m12")).toEqual({ status: "done", method: "one_click" });
      expect(await client.unsubscribe("m13")).toEqual({ status: "done", method: "mailto" });
      const link = await client.unsubscribe("m14");
      expect(link.status).toBe("open_link");
      expect(link.status === "open_link" && link.url.startsWith("https://")).toBe(true);
      expect(await client.unsubscribe("m15")).toEqual({ status: "unavailable" });
      expect((await client.summary()).counters.marketersUnsubscribed).toBe(3);
      dispose();
    });

    it("returns the summary, with the banner in the requested language", async () => {
      const { client, dispose } = await subject();
      const en = await client.summary("en-AU");
      expect(en.address).toBe(MEMORY_ADDRESS);
      expect(en.counters.bulkFiled30d).toBe(4);
      expect(en.banner?.ctaUrl).toBe("https://yourtal.gaiada.com/studio/onboarding");
      const id = await client.summary("id-ID");
      expect(id.banner?.title).not.toBe(en.banner?.title);
      dispose();
    });

    it("notifies listeners of changes, and stops after unsubscribing", async () => {
      const { client, deliver, dispose } = await subject();
      const seen: { folders: boolean; messages: boolean }[] = [];
      const off = client.onChange((what) => seen.push(what));
      // Give a real client's stream a moment to connect before changing anything.
      await new Promise((r) => setTimeout(r, 50));
      await client.setRead(["m1"], true);
      await waitFor(() => seen.some((w) => w.messages));
      seen.length = 0;
      deliver("Fresh arrival");
      await waitFor(() => seen.some((w) => w.messages));
      expect((await client.search("Fresh arrival")).total).toBe(1);
      off();
      seen.length = 0;
      await client.setRead(["m2"], true);
      await new Promise((r) => setTimeout(r, 80));
      expect(seen).toEqual([]);
      dispose();
    });

    it("rejects every call after close()", async () => {
      const { client, dispose } = await subject();
      client.close();
      expect((await failure(client.folders())).code).toBe("unavailable");
      expect((await failure(client.list("inbox"))).code).toBe("unavailable");
      dispose();
    });
  });
}
