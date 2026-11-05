import { afterEach, describe, expect, it, vi } from "vitest";

import { usdToAudMicros, USD_TO_AUD } from "./call-cost.js";
import {
  OllamaCloudProvider,
  OpenRouterProvider,
  TruncatedOutputError,
} from "./provider.js";
import { OpenRouterStatementProvider } from "./statement-provider.js";

/** Plan 7.2.a/b and 7.3.c: the request asks for the charge and a price ceiling; the answer's charge is kept. */

const RECEIPT = JSON.stringify({
  docType: { value: "receipt", confidence: 0.9 },
  payableAmount: { value: "29.00", confidence: 0.9 },
  lines: [],
  notes: { legible: true },
});
const PAGE = { bytes: Buffer.from("x"), mimeType: "image/jpeg" };

function stub(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return () =>
    JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
}

afterEach(() => vi.unstubAllGlobals());

describe("usdToAudMicros", () => {
  it("converts the reported USD charge at the one configured rate", () => {
    expect(usdToAudMicros(0.001)).toBe(Math.round(0.001 * USD_TO_AUD * 1e6));
    expect(usdToAudMicros(0)).toBe(0);
  });

  it("is null when the provider reported no charge", () => {
    expect(usdToAudMicros(undefined)).toBeNull();
    expect(usdToAudMicros("0.5")).toBeNull();
    expect(usdToAudMicros(-1)).toBeNull();
  });
});

describe("OpenRouter request", () => {
  it("sends the registry price ceiling, and no deprecated usage flag", async () => {
    const body = stub({
      choices: [{ message: { content: RECEIPT }, finish_reason: "stop" }],
      usage: {},
    });
    await new OpenRouterProvider(
      "google/gemma-4-31b-it",
      undefined,
      "k",
    ).extract(PAGE);
    expect(body().usage).toBeUndefined();
    expect(body().provider.max_price).toEqual({ prompt: 0.4, completion: 0.6 });
  });

  it("sends the ceiling on statement chunk calls too", async () => {
    const body = stub({
      choices: [
        {
          message: { content: '{"lines":[],"notes":{}}' },
          finish_reason: "stop",
        },
      ],
    });
    await new OpenRouterStatementProvider("z-ai/glm-5.3", "k").extractChunk(
      ["t"],
      { from: 1, to: 1 },
      1,
      "day_first",
      "AUD",
    );
    expect(body().provider.max_price.prompt).toBeGreaterThan(0);
  });

  it("adds nothing to an Ollama request", async () => {
    const body = stub({
      choices: [{ message: { content: RECEIPT }, finish_reason: "stop" }],
    });
    await new OllamaCloudProvider("gemma4:31b", "k").extract(PAGE);
    expect(body().usage).toBeUndefined();
    expect(body().provider).toBeUndefined();
  });
});

describe("what a call cost", () => {
  it("keeps the charge of an answered call, in AUD micros", async () => {
    stub({
      choices: [{ message: { content: RECEIPT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00035 },
    });
    const provider = new OpenRouterProvider(
      "google/gemma-4-31b-it",
      undefined,
      "k",
    );
    const result = await provider.extract(PAGE);
    expect(result.meta.costMicros).toBe(usdToAudMicros(0.00035));
    expect(provider.modelCalls).toMatchObject([
      {
        costMicros: usdToAudMicros(0.00035),
        inputTokens: 10,
        outputTokens: 5,
        error: null,
      },
    ]);
  });

  it("still counts a call that was charged and then truncated", async () => {
    stub({
      choices: [{ message: { content: '{"doc' }, finish_reason: "length" }],
      usage: { cost: 0.01 },
    });
    const provider = new OpenRouterProvider(
      "google/gemma-4-31b-it",
      undefined,
      "k",
    );
    await expect(provider.extract(PAGE)).rejects.toBeInstanceOf(
      TruncatedOutputError,
    );
    expect(provider.modelCalls).toHaveLength(1);
    expect(provider.modelCalls[0]).toMatchObject({
      costMicros: usdToAudMicros(0.01),
    });
    expect(provider.modelCalls[0]!.error).toMatch(/output cap/);
  });

  it("still counts a call that was charged and answered with unparseable text", async () => {
    stub({
      choices: [{ message: { content: "sorry, no" }, finish_reason: "stop" }],
      usage: { cost: 0.002 },
    });
    const provider = new OpenRouterProvider(
      "google/gemma-4-31b-it",
      undefined,
      "k",
    );
    await expect(provider.extract(PAGE)).rejects.toThrow(/No JSON/);
    expect(provider.modelCalls).toMatchObject([
      { costMicros: usdToAudMicros(0.002) },
    ]);
    expect(provider.modelCalls[0]!.error).toMatch(/No JSON/);
  });

  it("records nothing for a call that got no answer (HTTP error)", async () => {
    stub({ error: "nope" }, 502);
    const provider = new OpenRouterProvider(
      "google/gemma-4-31b-it",
      undefined,
      "k",
    );
    await expect(provider.extract(PAGE)).rejects.toThrow(/502/);
    expect(provider.modelCalls).toEqual([]);
  });

  it("keeps one entry per statement chunk call", async () => {
    stub({
      choices: [
        {
          message: { content: '{"lines":[],"notes":{}}' },
          finish_reason: "stop",
        },
      ],
      usage: { cost: 0.0003 },
    });
    const provider = new OpenRouterStatementProvider("z-ai/glm-5.3", "k");
    await provider.extractChunk(
      ["a"],
      { from: 1, to: 1 },
      2,
      "day_first",
      "AUD",
    );
    await provider.extractChunk(
      ["b"],
      { from: 2, to: 2 },
      2,
      "day_first",
      "AUD",
    );
    expect(provider.modelCalls.map((c) => c.costMicros)).toEqual([
      usdToAudMicros(0.0003),
      usdToAudMicros(0.0003),
    ]);
  });
});
