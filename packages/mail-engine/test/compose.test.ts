import { describe, expect, it } from "vitest";
import type { MessageDetail } from "../src/model";
import { assertSendable, draftEmailObject, draftFrom, recipientsOf } from "../src/ops/compose";

const OWN = "geewizduck@yourtal.gaiada.com";

function message(over: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: "m1", threadId: "t1", folder: "inbox",
    from: { name: "Ann", email: "ann@example.com" },
    to: [{ email: OWN }, { email: "bob@example.com" }],
    subject: "Plan", preview: "p", receivedAt: "2026-11-01T00:00:00Z", unread: false, flagged: false,
    hasAttachment: false, bulk: false,
    cc: [{ email: "cat@example.com" }], replyTo: [], messageId: "<a@x>", references: ["<z@x>"],
    text: "line one\n\nline three", hasHtml: false, attachments: [], unsubscribe: null,
    ...over,
  };
}

describe("draftFrom", () => {
  it("reply goes to the sender, quotes the text and threads", () => {
    const d = draftFrom(message(), "reply", OWN);
    expect(d.to).toEqual([{ name: "Ann", email: "ann@example.com" }]);
    expect(d.cc).toBeUndefined();
    expect(d.subject).toBe("Re: Plan");
    expect(d.inReplyTo).toBe("<a@x>");
    expect(d.references).toEqual(["<z@x>", "<a@x>"]);
    expect(d.text).toBe("\n\nOn 2026-11-01T00:00:00Z, Ann <ann@example.com> wrote:\n> line one\n>\n> line three\n");
  });

  it("does not stack Re: prefixes, whatever their case", () => {
    expect(draftFrom(message({ subject: "RE: Plan" }), "reply", OWN).subject).toBe("RE: Plan");
    expect(draftFrom(message({ subject: "Fwd: Plan" }), "forward", OWN).subject).toBe("Fwd: Plan");
  });

  it("prefers Reply-To", () => {
    const d = draftFrom(message({ replyTo: [{ email: "list@example.com" }] }), "reply", OWN);
    expect(d.to).toEqual([{ email: "list@example.com" }]);
  });

  it("reply-all keeps everyone except the mailbox itself, without duplicates", () => {
    const d = draftFrom(
      message({ to: [{ email: OWN }, { email: "Bob@Example.com" }, { email: "ann@example.com" }], cc: [{ email: "bob@example.com" }, { email: "cat@example.com" }] }),
      "replyAll",
      OWN,
    );
    expect(d.to.map((a) => a.email)).toEqual(["ann@example.com", "Bob@Example.com"]);
    expect(d.cc?.map((a) => a.email)).toEqual(["cat@example.com"]);
  });

  it("forward has no recipients, carries real attachments but not inline images, and quotes the headers", () => {
    const att = (name: string, inline: boolean) => ({ blobId: name, name, type: "image/png", size: 1, inline });
    const d = draftFrom(message({ attachments: [att("a.png", false), att("logo.png", true)] }), "forward", OWN);
    expect(d.to).toEqual([]);
    expect(d.attachments?.map((a) => a.name)).toEqual(["a.png"]);
    expect(d.inReplyTo).toBeUndefined();
    expect(d.text).toContain("---------- Forwarded message ----------");
    expect(d.text).toContain("From: Ann <ann@example.com>");
    expect(d.text).toContain("Subject: Plan");
  });

  it("falls back to the preview for an HTML-only message", () => {
    const d = draftFrom(message({ text: null, preview: "short preview" }), "reply", OWN);
    expect(d.text).toContain("> short preview");
  });
});

describe("recipients", () => {
  it("collects To, Cc and Bcc once each, case-insensitively", () => {
    expect(
      recipientsOf({ to: [{ email: "A@x.com" }], cc: [{ email: "a@x.com" }, { email: " b@x.com " }], bcc: [{ email: "" }], subject: "", text: "" }),
    ).toEqual(["A@x.com", "b@x.com"]);
  });

  it("assertSendable allows 1 to 10 and refuses 0 and 11", () => {
    const to = (n: number) => Array.from({ length: n }, (_v, i) => ({ email: `p${i}@x.com` }));
    expect(assertSendable({ to: to(1), subject: "", text: "" })).toHaveLength(1);
    expect(assertSendable({ to: to(10), subject: "", text: "" })).toHaveLength(10);
    expect(() => assertSendable({ to: [], subject: "", text: "" })).toThrow(/recipient/);
    expect(() => assertSendable({ to: to(11), subject: "", text: "" })).toThrow(/at most 10/);
  });
});

describe("draftEmailObject", () => {
  it("omits empty optional fields and marks attachments", () => {
    const o = draftEmailObject(
      { to: [{ name: "Ann", email: "ann@example.com" }], subject: "s", text: "t", attachments: [{ blobId: "b1", name: "a.pdf", type: "application/pdf", size: 3, inline: false }] },
      OWN,
      "mb-drafts",
      true,
    );
    expect(o).toEqual({
      mailboxIds: { "mb-drafts": true },
      keywords: { $draft: true, $seen: true },
      from: [{ email: OWN }],
      to: [{ name: "Ann", email: "ann@example.com" }],
      subject: "s",
      bodyValues: { body: { value: "t" } },
      textBody: [{ partId: "body", type: "text/plain" }],
      attachments: [{ blobId: "b1", type: "application/pdf", name: "a.pdf", disposition: "attachment" }],
    });
  });
});
