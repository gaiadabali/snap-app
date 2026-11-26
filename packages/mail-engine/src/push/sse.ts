// Server-sent events over a fetch stream. The browser EventSource cannot send an
// Authorization header and the mail token must never go in a URL (BUILD.md B2),
// so the engine reads `text/event-stream` itself.

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseParser {
  push(chunk: string): void;
}

/** Incremental `text/event-stream` parser (WHATWG HTML §9.2): any chunking, CRLF, CR or LF. */
export function createSseParser(onEvent: (e: SseEvent) => void): SseParser {
  let buffer = "";
  let started = false;
  let event = "";
  let data: string[] = [];

  function line(text: string): void {
    if (text === "") {
      if (data.length > 0) onEvent({ event: event === "" ? "message" : event, data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    if (text.charCodeAt(0) === 58 /* ":" comment, used for pings */) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.charCodeAt(0) === 32) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    // `id` and `retry` are not used: the engine reconnects with its own backoff.
  }

  return {
    push(chunk) {
      buffer += chunk;
      if (!started && buffer.length > 0) {
        started = true;
        if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
      }
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer.charCodeAt(i);
        if (c !== 10 && c !== 13) continue;
        // A lone CR at the very end may be the first half of CRLF: wait for more.
        if (c === 13 && i === buffer.length - 1) break;
        const text = buffer.slice(start, i);
        if (c === 13 && buffer.charCodeAt(i + 1) === 10) i++;
        start = i + 1;
        line(text);
      }
      buffer = buffer.slice(start);
    },
  };
}

/** Streaming UTF-8 decoder. Hermes may lack TextDecoder; the fallback is enough for JSON state events. */
export function createChunkDecoder(): (bytes: Uint8Array) => string {
  if (typeof TextDecoder === "function") {
    const decoder = new TextDecoder("utf-8");
    return (bytes) => decoder.decode(bytes, { stream: true });
  }
  return (bytes) => {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] ?? 0);
    return out;
  };
}
