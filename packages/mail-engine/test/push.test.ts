import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailClient } from "../src/client";
import { createSseParser } from "../src/push/sse";
import type { SseEvent } from "../src/push/sse";
import { createFakeProxy } from "./fake-proxy";

afterEach(() => {
  vi.useRealTimers();
});

describe("SSE parser", () => {
  function parse(chunks: string[]): SseEvent[] {
    const out: SseEvent[] = [];
    const parser = createSseParser((e) => out.push(e));
    for (const c of chunks) parser.push(c);
    return out;
  }

  const wire = 'event: state\ndata: {"changed":{"a":{"Email":"s1"}}}\n\n';

  it("parses a state event", () => {
    expect(parse([wire])).toEqual([{ event: "state", data: '{"changed":{"a":{"Email":"s1"}}}' }]);
  });

  it("gives the same result however the bytes are chunked", () => {
    const text = `: ping\n\n${wire}event: state\ndata: two\n\n`;
    const whole = parse([text]);
    expect(whole).toHaveLength(2);
    expect(parse(text.split(""))).toEqual(whole);
    for (let cut = 1; cut < text.length; cut += 7) {
      expect(parse([text.slice(0, cut), text.slice(cut)])).toEqual(whole);
    }
  });

  it("handles CRLF and lone CR line endings, even split across chunks", () => {
    expect(parse(["event: state\r\ndata: x\r\n\r\n"])).toEqual([{ event: "state", data: "x" }]);
    // A CR at the very end of a chunk is held back (it may be half of a CRLF) until more arrives.
    expect(parse(["event: state\rdata: y\r\r"])).toEqual([]);
    expect(parse(["event: state\rdata: y\r\r", ": ping\n"])).toEqual([{ event: "state", data: "y" }]);
    expect(parse(["event: state\r", "\ndata: z\r", "\n\r", "\n"])).toEqual([{ event: "state", data: "z" }]);
  });

  it("joins multi-line data, defaults the event name and ignores comments, ids and retry", () => {
    expect(parse(["data: a\ndata: b\n\n"])).toEqual([{ event: "message", data: "a\nb" }]);
    expect(parse([": keep-alive\n\nid: 5\nretry: 3000\nevent: ping\ndata: {}\n\n"])).toEqual([{ event: "ping", data: "{}" }]);
  });

  it("drops a leading BOM and a dispatch with no data", () => {
    expect(parse(["﻿event: state\ndata: b\n\n"])).toEqual([{ event: "state", data: "b" }]);
    expect(parse(["event: state\n\n"])).toEqual([]);
  });
});

describe("push over SSE", () => {
  it("connects with a bearer header and never puts the token in the URL", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "sse" });
    const off = client.onChange(() => {});
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    const stream = proxy.requests.find((r) => r.url.includes("/jmap/eventsource"))!;
    expect(stream.url).toBe(
      "https://proxy.test/api/spambank/jmap/eventsource?types=Email%2CMailbox&closeafter=no&ping=30",
    );
    expect(stream.headers["authorization"]).toMatch(/^Bearer tok-/);
    expect(stream.headers["accept"]).toBe("text/event-stream");
    off();
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(0));
    client.close();
  });

  it("maps Email and Mailbox state changes to messages and folders", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "sse" });
    const seen: { folders: boolean; messages: boolean }[] = [];
    client.onChange((w) => seen.push(w));
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    proxy.deliver("Hello");
    await vi.waitFor(() => expect(seen).toEqual([{ folders: true, messages: true }]));
    client.close();
  });

  it("uses one stream for any number of listeners, and closes it with the last", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "sse" });
    let a = 0;
    let b = 0;
    const offA = client.onChange(() => a++);
    const offB = client.onChange(() => b++);
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    proxy.deliver("x");
    await vi.waitFor(() => expect([a, b]).toEqual([1, 1]));
    offA();
    expect(proxy.openStreams()).toBe(1);
    offB();
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(0));
    client.close();
  });

  it("reconnects with a fresh token when the server closes the stream, and reports possible gaps", async () => {
    const proxy = createFakeProxy();
    let mints = 0;
    const client = createMailClient({
      getSession: async () => {
        mints++;
        return proxy.mint(1000 * 60 * 2.5); // so the token is inside the refresh window on reconnect
      },
      fetch: proxy.fetch,
      push: "sse",
    });
    const seen: { folders: boolean; messages: boolean }[] = [];
    client.onChange((w) => seen.push(w));
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    expect(seen).toEqual([]);
    proxy.closeStreams(); // server closes after 25 minutes in production
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1), { timeout: 3000 });
    expect(mints).toBeGreaterThanOrEqual(1);
    // A reconnect may have missed changes, so listeners are told to refresh.
    expect(seen).toEqual([{ folders: true, messages: true }]);
    client.close();
  });

  it("stops the stream and never reconnects after close()", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "sse" });
    client.onChange(() => {});
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    client.close();
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(0));
    await new Promise((r) => setTimeout(r, 400));
    expect(proxy.openStreams()).toBe(0);
  });
});

describe("push by polling", () => {
  it("takes a baseline, then reports a change at the next tick", async () => {
    vi.useFakeTimers();
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll", pollMs: 30_000 });
    const seen: { folders: boolean; messages: boolean }[] = [];
    client.onChange((w) => seen.push(w));
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual([]); // the first poll is only a baseline
    const polls = () => proxy.methods().filter((m) => m === "Email/get").length;
    expect(polls()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toEqual([]); // nothing changed
    expect(polls()).toBe(2);

    proxy.deliver("poll me");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toEqual([{ folders: true, messages: true }]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toHaveLength(1); // no new change, no new event
    client.close();
  });

  it("polls only while someone is listening", async () => {
    vi.useFakeTimers();
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll", pollMs: 5000 });
    const off = client.onChange(() => {});
    await vi.advanceTimersByTimeAsync(5100);
    const before = proxy.requests.length;
    off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(proxy.requests.length).toBe(before);
    client.close();
  });

  it("defaults to 30 seconds", async () => {
    vi.useFakeTimers();
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll" });
    client.onChange(() => {});
    await vi.advanceTimersByTimeAsync(10);
    const base = proxy.requests.length;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(proxy.requests.length).toBe(base);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(proxy.requests.length).toBeGreaterThan(base);
    client.close();
  });

  it("keeps polling through a failed tick", async () => {
    vi.useFakeTimers();
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "poll", pollMs: 2000 });
    const seen: unknown[] = [];
    client.onChange((w) => seen.push(w));
    await vi.advanceTimersByTimeAsync(10);
    proxy.deliver("after outage");
    proxy.dropNext();
    await vi.advanceTimersByTimeAsync(2000); // this tick fails
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000); // the next one sees the change
    expect(seen).toHaveLength(1);
    client.close();
  });
});

describe("auto mode", () => {
  it("falls back to polling when fetch cannot stream (React Native)", async () => {
    vi.useFakeTimers();
    const proxy = createFakeProxy();
    proxy.noStreaming = true;
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch, push: "auto", pollMs: 3000 });
    const seen: unknown[] = [];
    client.onChange((w) => seen.push(w));
    await vi.advanceTimersByTimeAsync(50);
    expect(proxy.requests.some((r) => r.url.includes("/jmap/eventsource"))).toBe(true);
    proxy.deliver("via poll");
    await vi.advanceTimersByTimeAsync(3100);
    expect(seen).toEqual([{ folders: true, messages: true }]);
    client.close();
  });

  it("uses SSE when the response streams", async () => {
    const proxy = createFakeProxy();
    const client = createMailClient({ getSession: async () => proxy.mint(), fetch: proxy.fetch });
    client.onChange(() => {});
    await vi.waitFor(() => expect(proxy.openStreams()).toBe(1));
    expect(proxy.methods().filter((m) => m === "Email/get")).toHaveLength(0); // no polling alongside
    client.close();
  });
});
