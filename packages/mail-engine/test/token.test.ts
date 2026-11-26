import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailClient } from "../src/client";
import { MailError } from "../src/model";
import type { MailErrorCode, MailSession } from "../src/model";
import { createFakeProxy } from "./fake-proxy";

afterEach(() => {
  vi.useRealTimers();
});

function counted(proxy: ReturnType<typeof createFakeProxy>, ttlMs?: number) {
  const mints: MailSession[] = [];
  return {
    mints,
    getSession: async () => {
      const s = proxy.mint(ttlMs);
      mints.push(s);
      return s;
    },
  };
}

async function code(p: Promise<unknown>): Promise<MailErrorCode | "no error"> {
  try {
    await p;
    return "no error";
  } catch (e) {
    if (e instanceof MailError) return e.code;
    throw e;
  }
}

describe("mail token handling", () => {
  it("mints once for concurrent requests (single flight)", async () => {
    const proxy = createFakeProxy();
    const { mints, getSession } = counted(proxy);
    const client = createMailClient({ getSession, fetch: proxy.fetch, push: "poll" });
    await Promise.all([client.folders(), client.list("inbox"), client.list("spam"), client.summary()]);
    expect(mints).toHaveLength(1);
  });

  it("sends the token as a bearer header on every request", async () => {
    const proxy = createFakeProxy();
    const { getSession } = counted(proxy);
    const client = createMailClient({ getSession, fetch: proxy.fetch, push: "poll" });
    await client.list("inbox");
    expect(proxy.requests.length).toBeGreaterThan(2);
    for (const r of proxy.requests) expect(r.headers["authorization"]).toBe("Bearer tok-1");
  });

  it("refreshes two minutes before the token expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T00:00:00Z"));
    const proxy = createFakeProxy();
    const { mints, getSession } = counted(proxy, 30 * 60 * 1000);
    const client = createMailClient({ getSession, fetch: proxy.fetch, push: "poll" });
    await client.folders();
    expect(mints).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-27T00:27:00Z")); // 3 min left: still fine
    await client.folders();
    expect(mints).toHaveLength(1);

    vi.setSystemTime(new Date("2026-11-27T00:28:30Z")); // 1.5 min left: refresh first
    await client.folders();
    expect(mints).toHaveLength(2);
    expect(proxy.requests.at(-1)?.headers["authorization"]).toBe("Bearer tok-2");
  });

  it("mints a new token and retries once when the proxy answers 401", async () => {
    const proxy = createFakeProxy();
    const { mints, getSession } = counted(proxy);
    const client = createMailClient({ getSession, fetch: proxy.fetch, push: "poll" });
    await client.folders();
    proxy.revokeAll(); // e.g. the token was revoked on the server
    const folders = await client.folders();
    expect(folders).toHaveLength(6);
    expect(mints).toHaveLength(2);
  });

  it("gives up with `unauthorized` when a fresh token is refused too", async () => {
    const proxy = createFakeProxy();
    const { mints, getSession } = counted(proxy);
    const client = createMailClient({ getSession, fetch: proxy.fetch, push: "poll" });
    proxy.rejectAllTokens = true;
    expect(await code(client.folders())).toBe("unauthorized");
    expect(mints).toHaveLength(2); // one try, one retry, no loop
  });

  it("surfaces errors from the app's own mint call", async () => {
    const proxy = createFakeProxy();
    const notEnabled = createMailClient({
      getSession: async () => {
        throw new MailError("not_enabled", "switch Spambank on first");
      },
      fetch: proxy.fetch,
      push: "poll",
    });
    expect(await code(notEnabled.folders())).toBe("not_enabled");

    const broken = createMailClient({
      getSession: async () => {
        throw new Error("app backend down");
      },
      fetch: proxy.fetch,
      push: "poll",
    });
    expect(await code(broken.folders())).toBe("unavailable");

    const malformed = createMailClient({
      getSession: async () => ({ token: "", expiresAt: "", sessionUrl: "", helpersBase: "", address: "" }),
      fetch: proxy.fetch,
      push: "poll",
    });
    expect(await code(malformed.folders())).toBe("unavailable");
  });

  it("recovers after a failed mint", async () => {
    const proxy = createFakeProxy();
    let fail = true;
    const client = createMailClient({
      getSession: async () => {
        if (fail) throw new Error("temporarily down");
        return proxy.mint();
      },
      fetch: proxy.fetch,
      push: "poll",
    });
    expect(await code(client.folders())).toBe("unavailable");
    fail = false;
    expect(await client.folders()).toHaveLength(6);
  });
});

describe("error mapping", () => {
  async function failing(status: number, body: Record<string, unknown>): Promise<MailError> {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll" });
    await client.folders(); // warm up so only the next call fails
    proxy.failNext(status, body);
    try {
      await client.list("inbox");
    } catch (e) {
      if (e instanceof MailError) return e;
    }
    throw new Error("expected a MailError");
  }

  it.each([
    [429, { code: "rate_limited", message: "slow down" }, "rate_limited"],
    [429, { code: "daily_send_cap", message: "cap" }, "daily_send_cap"],
    [400, { code: "too_many_recipients", message: "max 10" }, "too_many_recipients"],
    [409, { code: "not_enabled", message: "no mailbox" }, "not_enabled"],
    [503, { code: "spambank_unavailable", message: "stalwart down" }, "unavailable"],
    [502, { code: "upstream_auth", message: "bad credential" }, "unavailable"],
    [500, {}, "unavailable"],
    [400, { code: "method_not_allowed", message: "no" }, "rejected"],
    [400, { code: "envelope_required", message: "no" }, "rejected"],
    [403, { code: "not_allowed", message: "teen account" }, "rejected"],
  ] as const)("HTTP %i %j becomes %s", async (status, body, expected) => {
    const error = await failing(status, { ...body });
    expect(error.code).toBe(expected);
    expect(error.status).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("maps a dropped connection to `network`, keeping the cause", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll" });
    await client.folders();
    proxy.dropNext();
    try {
      await client.list("inbox");
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(MailError);
      expect((e as MailError).code).toBe("network");
      expect((e as MailError).cause).toBeInstanceOf(TypeError);
    }
  });

  it("maps a JMAP method error to a MailError", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({
      getSession: async () => proxy.mint(),
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/jmap/api")
          ? Promise.resolve(
              new Response(JSON.stringify({ methodResponses: [["error", { type: "serverFail" }, "q"]] }), {
                status: 200,
              }),
            )
          : proxy.fetch(input, init)) as typeof fetch,
      push: "poll",
    });
    expect(await code(client.list("inbox"))).toBe("unavailable");
  });

  it("refuses to send to nobody, or to more than ten people, before any request", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll" });
    expect(await code(client.send({ to: [], subject: "s", text: "t" }))).toBe("rejected");
    const eleven = Array.from({ length: 11 }, (_v, i) => ({ email: `p${i}@example.com` }));
    expect(await code(client.send({ to: eleven, subject: "s", text: "t" }))).toBe("too_many_recipients");
    expect(proxy.requests).toHaveLength(0);
  });
});
