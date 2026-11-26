/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { createMailClient } from "../src/client";
import type { MailClient } from "../src/model";
import { ACCOUNT, BASE, createFakeProxy } from "./fake-proxy";
import type { FakeProxy } from "./fake-proxy";

// Asserts the exact JMAP requests the engine sends (spambank/BUILD.md §4.3, §7).

function setup(): { proxy: FakeProxy; client: MailClient; calls: (name: string) => any[] } {
  const proxy = createFakeProxy();
  const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll" });
  const calls = (name: string) =>
    proxy.apiBodies().flatMap((b) => (b["methodCalls"] as any[]).filter((c) => c[0] === name));
  return { proxy, client, calls };
}

describe("JMAP request shapes", () => {
  it("lists with Email/query then Email/get through a back-reference", async () => {
    const { proxy, client, calls } = setup();
    await client.list("inbox", { position: 3, limit: 10 });
    const body = proxy.apiBodies().at(-1)!;
    expect(body["using"]).toEqual([
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ]);
    const [query, get] = body["methodCalls"];
    expect(query).toEqual([
      "Email/query",
      {
        accountId: ACCOUNT,
        filter: { inMailbox: "mb-inbox" },
        sort: [{ property: "receivedAt", isAscending: false }],
        position: 3,
        limit: 10,
        calculateTotal: true,
      },
      "q",
    ]);
    expect(get[0]).toBe("Email/get");
    expect(get[1]["#ids"]).toEqual({ resultOf: "q", name: "Email/query", path: "/ids" });
    expect(get[1]["properties"]).toEqual(expect.arrayContaining(["id", "mailboxIds", "keywords", "preview", "header:List-Unsubscribe:asURLs"]));
    expect(calls("Email/query")).toHaveLength(1);
  });

  it("lists the custom Junk folder by the id the proxy reports", async () => {
    const { proxy, client } = setup();
    await client.list("junk");
    const query = proxy.apiBodies().at(-1)!["methodCalls"][0];
    expect(query[1]["filter"]).toEqual({ inMailbox: "mb-junk" });
    await client.list("spam");
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["filter"]).toEqual({ inMailbox: "mb-spam" });
  });

  it("falls back to the folder named Junk when the summary is unavailable", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({
      getSession: async () => proxy.mint(),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/mail/summary") ? Promise.resolve(new Response("{}", { status: 503 })) : proxy.fetch(input, init)) as typeof fetch,
      push: "poll",
    });
    expect((await client.list("junk")).total).toBe(4);
  });

  it("searches with Email/query {text} and SearchSnippet/get", async () => {
    const { proxy, client } = setup();
    const { items } = await client.search("checklist");
    const body = proxy.apiBodies().at(-1)!;
    expect(body["methodCalls"].map((c: any[]) => c[0])).toEqual(["Email/query", "Email/get", "SearchSnippet/get"]);
    expect(body["methodCalls"][0][1]["filter"]).toEqual({ text: "checklist" });
    expect(body["methodCalls"][2][1]).toMatchObject({
      filter: { text: "checklist" },
      "#emailIds": { resultOf: "q", name: "Email/query", path: "/ids" },
    });
    // The snippet's <mark> tags are stripped from the preview.
    expect(items[0]?.preview).not.toContain("<mark>");
    expect(items[0]?.preview).toContain("checklist");
  });

  it("gets a message with its text body values", async () => {
    const { proxy, client } = setup();
    await client.get("m2");
    const get = proxy.apiBodies().at(-1)!["methodCalls"][0];
    expect(get[0]).toBe("Email/get");
    expect(get[1]).toMatchObject({ ids: ["m2"], fetchTextBodyValues: true });
    expect(get[1]["properties"]).toEqual(
      expect.arrayContaining(["textBody", "htmlBody", "bodyValues", "attachments", "header:List-Unsubscribe-Post:asText"]),
    );
  });

  it("sets keywords with Email/set patches", async () => {
    const { proxy, client } = setup();
    await client.setRead(["m1", "m2"], true);
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({
      m1: { "keywords/$seen": true },
      m2: { "keywords/$seen": true },
    });
    await client.setRead(["m1"], false);
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({ m1: { "keywords/$seen": null } });
    await client.setFlagged(["m1"], true);
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({ m1: { "keywords/$flagged": true } });
  });

  it("moving into Spam adds $junk, moving out adds $notjunk", async () => {
    const { proxy, client } = setup();
    await client.move(["m1"], "spam");
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({
      m1: { mailboxIds: { "mb-spam": true }, "keywords/$junk": true, "keywords/$notjunk": null },
    });
    await client.move(["m1"], "inbox");
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({
      m1: { mailboxIds: { "mb-inbox": true }, "keywords/$notjunk": true, "keywords/$junk": null },
    });
    // Between two non-spam folders there is no training signal.
    await client.move(["m1"], "trash");
    expect(proxy.apiBodies().at(-1)!["methodCalls"][0][1]["update"]).toEqual({ m1: { mailboxIds: { "mb-trash": true } } });
  });

  it("removes to Trash, and destroys what is already there, in one Email/set", async () => {
    const { proxy, client } = setup();
    await client.remove(["m8", "m19"]);
    const set = proxy.apiBodies().at(-1)!["methodCalls"][0];
    expect(set[0]).toBe("Email/set");
    expect(set[1]["update"]).toEqual({ m8: { mailboxIds: { "mb-trash": true } } });
    expect(set[1]["destroy"]).toEqual(["m19"]);
  });

  it("sends with an explicit envelope and moves Drafts to Sent on success", async () => {
    const { proxy, client } = setup();
    await client.send({
      to: [{ name: "Maria", email: "maria@example.com" }],
      cc: [{ email: "dev@example.org" }],
      bcc: [{ email: "Maria@Example.com" }, { email: "hidden@example.net" }],
      subject: "Hi",
      text: "Body",
      inReplyTo: "<m1@example.com>",
      references: ["<m1@example.com>"],
    });
    const [emailSet, submission] = proxy.apiBodies().at(-1)!["methodCalls"];
    expect(emailSet[0]).toBe("Email/set");
    const draft = emailSet[1]["create"]["draft"];
    expect(draft).toMatchObject({
      mailboxIds: { "mb-drafts": true },
      keywords: { $draft: true, $seen: true },
      from: [{ email: proxy.address }],
      to: [{ name: "Maria", email: "maria@example.com" }],
      cc: [{ email: "dev@example.org" }],
      bcc: [{ email: "Maria@Example.com" }, { email: "hidden@example.net" }],
      subject: "Hi",
      inReplyTo: ["<m1@example.com>"],
      references: ["<m1@example.com>"],
      textBody: [{ partId: "body", type: "text/plain" }],
      bodyValues: { body: { value: "Body" } },
    });
    expect(submission[0]).toBe("EmailSubmission/set");
    expect(submission[1]["create"]["sub"]).toEqual({
      identityId: "ident-1",
      emailId: "#draft",
      envelope: {
        mailFrom: { email: proxy.address },
        // De-duplicated case-insensitively across To, Cc and Bcc.
        rcptTo: [{ email: "maria@example.com" }, { email: "dev@example.org" }, { email: "hidden@example.net" }],
      },
    });
    expect(submission[1]["onSuccessUpdateEmail"]).toEqual({
      "#sub": { "keywords/$draft": null, "mailboxIds/mb-drafts": null, "mailboxIds/mb-sent": true },
    });
  });

  it("a saved draft is replaced in the same Email/set that creates its successor", async () => {
    const { proxy, client } = setup();
    await client.saveDraft({ draftId: "m18", to: [{ email: "sam@example.com" }], subject: "Notes", text: "v2" });
    const set = proxy.apiBodies().at(-1)!["methodCalls"][0][1];
    expect(set["destroy"]).toEqual(["m18"]);
    expect(set["create"]["draft"]["keywords"]).toEqual({ $draft: true, $seen: true });
  });

  it("uploads raw bytes with the bearer token in a header, never in the URL", async () => {
    const { proxy, client } = setup();
    await client.upload({ kind: "blob", blob: new Blob(["abc"], { type: "text/plain" }), name: "a.txt" });
    const up = proxy.requests.find((r) => r.url.includes("/jmap/upload/"))!;
    expect(up.url).toBe(`${BASE}/jmap/upload/${ACCOUNT}/`);
    expect(up.method).toBe("POST");
    expect(up.headers["content-type"]).toBe("text/plain");
    expect(up.headers["authorization"]).toMatch(/^Bearer tok-/);
  });

  it("downloads through the URL template with the token in a header", async () => {
    const { proxy, client } = setup();
    const att = (await client.get("m2")).attachments[0]!;
    await client.download(att);
    const dl = proxy.requests.find((r) => r.url.includes("/jmap/download/"))!;
    expect(dl.url).toBe(`${BASE}/jmap/download/${ACCOUNT}/${encodeURIComponent(att.blobId)}/checklist.pdf?accept=application%2Fpdf`);
    expect(dl.headers["authorization"]).toMatch(/^Bearer tok-/);
    for (const r of proxy.requests) expect(r.url).not.toMatch(/tok-\d/);
  });

  it("on a native platform hands the download URL and auth headers to downloadToUri", async () => {
    const proxy = createFakeProxy();
    let seen: { url: string; headers: Record<string, string>; name: string } | null = null;
    const client = createMailClient({
      getSession: async () => proxy.mint(),
      fetch: proxy.fetch,
      push: "poll",
      downloadToUri: async (url, headers, name) => {
        seen = { url, headers, name };
        return { uri: "file:///cache/checklist.pdf" };
      },
    });
    const att = (await client.get("m2")).attachments[0]!;
    expect(await client.download(att)).toEqual({ uri: "file:///cache/checklist.pdf" });
    expect(seen).toMatchObject({ name: "checklist.pdf" });
    expect(seen!.url).toContain("/jmap/download/");
    expect(seen!.headers["Authorization"]).toMatch(/^Bearer tok-/);
  });

  it("reads a React Native file uri through fetch before uploading it", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({
      getSession: async () => proxy.mint(),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).startsWith("file://")
          ? Promise.resolve(new Response(new Blob(["picked"], { type: "image/png" })))
          : proxy.fetch(input, init)) as typeof fetch,
      push: "poll",
    });
    const att = await client.upload({ kind: "uri", uri: "file:///pick/a.png", name: "a.png", type: "image/png" });
    expect(att).toMatchObject({ name: "a.png", type: "image/png", size: 6 });
  });

  it("sends only headers and methods the proxy's CORS policy allows", async () => {
    // BUILD.md §4.3: headers Authorization, Content-Type (Accept is always allowed); methods GET, POST.
    const { proxy, client } = setup();
    await client.folders();
    await client.list("inbox");
    await client.search("a");
    await client.setRead(["m1"], true);
    await client.safeHtml("m12");
    await client.summary();
    await client.unsubscribe("m12");
    await client.upload({ kind: "blob", blob: new Blob(["x"], { type: "text/plain" }), name: "a.txt" });
    await client.download((await client.get("m2")).attachments[0]!);
    const stop = client.onChange(() => {});
    await new Promise((r) => setTimeout(r, 30));
    stop();
    client.close();
    for (const r of proxy.requests) {
      expect(["GET", "POST"], r.url).toContain(r.method);
      expect(Object.keys(r.headers).filter((h) => !["authorization", "content-type", "accept"].includes(h)), r.url).toEqual([]);
    }
  });

  it("only ever calls methods on the proxy's allow-list", async () => {
    const { proxy, client } = setup();
    await client.folders();
    await client.list("inbox");
    await client.search("a");
    await client.get("m1");
    await client.setRead(["m1"], true);
    await client.move(["m1"], "spam");
    await client.remove(["m1"]);
    await client.send({ to: [{ email: "x@example.com" }], subject: "s", text: "t" });
    const start = client.onChange(() => {});
    await new Promise((r) => setTimeout(r, 30));
    start();
    client.close();
    const allowed = new Set([
      "Core/echo", "Mailbox/get", "Mailbox/changes", "Mailbox/query", "Mailbox/queryChanges",
      "Email/get", "Email/changes", "Email/query", "Email/queryChanges", "Email/set",
      "Thread/get", "Thread/changes", "SearchSnippet/get", "Identity/get",
      "EmailSubmission/get", "EmailSubmission/changes", "EmailSubmission/query", "EmailSubmission/set", "Quota/get",
    ]);
    const used = new Set(proxy.methods());
    expect([...used].filter((m) => !allowed.has(m))).toEqual([]);
    // Never the provisioning-only methods (Mailbox/set, SieveScript/*, Identity/set ...).
    expect([...used].some((m) => /\/set$/.test(m) && !["Email/set", "EmailSubmission/set"].includes(m))).toBe(false);
  });
});
