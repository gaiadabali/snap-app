import { MailError } from "../model";
import { expandTemplate, isRecord } from "../jmap/transport";
import type { Transport } from "../jmap/transport";
import { createChunkDecoder, createSseParser } from "./sse";

// Live updates (BUILD.md F2): the proxied EventSource where fetch can stream,
// otherwise (React Native) a poll of the Email and Mailbox state strings.

export interface PushDeps {
  transport: Transport;
  mode: "auto" | "sse" | "poll";
  pollMs: number;
  emit(what: { folders: boolean; messages: boolean }): void;
}

export interface Push {
  start(): void;
  stop(): void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** In auto mode, give up on SSE after this many failures in a row and poll instead. */
const SSE_FAILURES_BEFORE_POLL = 3;
/** A stream that closes sooner than this did not really connect. */
const MIN_HEALTHY_STREAM_MS = 1000;

interface Run {
  stopped: boolean;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  wake: (() => void) | null;
  /** Cancels the stream being read, for fetch implementations that ignore AbortSignal mid-body. */
  cancel: (() => void) | null;
}

class SseUnsupported extends Error {}

export function createPush(deps: PushDeps): Push {
  let run: Run | null = null;
  /** Last seen state string per type, to drop duplicate notifications. */
  let known: Record<string, string> = {};

  function sleep(r: Run, ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (r.stopped) return resolve();
      const done = () => {
        if (r.timer !== null) clearTimeout(r.timer);
        r.timer = null;
        r.wake = null;
        resolve();
      };
      r.wake = done;
      r.timer = setTimeout(done, ms);
    });
  }

  function noteStates(states: Record<string, string>, baseline: boolean): void {
    let messages = false;
    let folders = false;
    for (const [type, state] of Object.entries(states)) {
      const before = known[type];
      known[type] = state;
      if (baseline || before === state) continue;
      if (type === "Email") messages = true;
      else if (type === "Mailbox") folders = true;
    }
    if (messages || folders) deps.emit({ folders, messages });
  }

  function onStateEvent(data: string): void {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(json) || !isRecord(json["changed"])) return;
    const merged: Record<string, string> = {};
    for (const account of Object.values(json["changed"])) {
      if (!isRecord(account)) continue;
      for (const [type, state] of Object.entries(account)) {
        if (typeof state === "string") merged[type] = state;
      }
    }
    noteStates(merged, false);
  }

  async function runSse(r: Run): Promise<"poll" | "stopped"> {
    let failures = 0;
    let connectedBefore = false;
    while (!r.stopped) {
      const startedAt = Date.now();
      try {
        const js = await deps.transport.jmap();
        if (js.eventSourceUrl === "") throw new SseUnsupported();
        const url = expandTemplate(js.eventSourceUrl, { types: "Email,Mailbox", closeafter: "no", ping: "30" });
        const res = await deps.transport.request(url, {
          // Only headers the proxy lists in Access-Control-Allow-Headers (Authorization,
          // Content-Type) or that CORS always allows (Accept): anything else fails the preflight.
          headers: { Accept: "text/event-stream" },
          signal: r.abort.signal,
        });
        const body = res.body;
        if (!body || typeof body.getReader !== "function") throw new SseUnsupported();
        if (connectedBefore) {
          // We may have missed changes while disconnected.
          deps.emit({ folders: true, messages: true });
        }
        connectedBefore = true;
        const reader = body.getReader();
        r.cancel = () => {
          void reader.cancel().catch(() => {});
        };
        const decode = createChunkDecoder();
        const parser = createSseParser((e) => {
          if (e.event === "state") onStateEvent(e.data);
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done || r.stopped) break;
          if (value) parser.push(decode(value));
        }
        // The server closes the stream after 25 minutes; reconnect with a fresh token.
        failures = Date.now() - startedAt < MIN_HEALTHY_STREAM_MS ? failures + 1 : 0;
      } catch (err) {
        if (r.stopped) return "stopped";
        if (err instanceof SseUnsupported) {
          if (deps.mode === "auto") return "poll";
          failures += SSE_FAILURES_BEFORE_POLL; // forced SSE: wait long, keep trying
        } else {
          failures += 1;
        }
      }
      if (r.stopped) return "stopped";
      if (deps.mode === "auto" && failures >= SSE_FAILURES_BEFORE_POLL) return "poll";
      await sleep(r, failures === 0 ? 250 : (BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)] ?? 30000));
    }
    return "stopped";
  }

  async function pollOnce(baseline: boolean): Promise<void> {
    const js = await deps.transport.jmap();
    const res = await deps.transport.call([
      ["Email/get", { accountId: js.accountId, ids: [], properties: ["id"] }, "e"],
      ["Mailbox/get", { accountId: js.accountId, ids: [], properties: ["id"] }, "m"],
    ]);
    const states: Record<string, string> = {};
    const email = res.get("e")["state"];
    const mailbox = res.get("m")["state"];
    if (typeof email === "string") states["Email"] = email;
    if (typeof mailbox === "string") states["Mailbox"] = mailbox;
    noteStates(states, baseline);
  }

  async function runPoll(r: Run): Promise<void> {
    let baseline = Object.keys(known).length === 0;
    while (!r.stopped) {
      try {
        await pollOnce(baseline);
        baseline = false;
      } catch (err) {
        // A transient failure just skips this tick; a closed client ends the loop.
        if (err instanceof MailError && err.code === "unauthorized") baseline = false;
      }
      await sleep(r, deps.pollMs);
    }
  }

  async function main(r: Run): Promise<void> {
    if (deps.mode !== "poll") {
      const outcome = await runSse(r);
      if (outcome === "stopped" || r.stopped) return;
    }
    await runPoll(r);
  }

  return {
    start() {
      if (run) return;
      known = {};
      const r: Run = { stopped: false, abort: new AbortController(), timer: null, wake: null, cancel: null };
      run = r;
      void main(r).catch(() => {
        // main() handles its own errors; this only guards against an unexpected throw.
      });
    },
    stop() {
      const r = run;
      if (!r) return;
      run = null;
      r.stopped = true;
      r.abort.abort();
      r.cancel?.();
      r.wake?.();
    },
  };
}
