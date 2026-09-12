import type { ChatMessage, ChatTransport, ChatTransportContext, ChatTransportEvents } from './types';

/**
 * The only transport this shell ships with.
 *
 * It calls no AI provider — not Ollama, not Bedrock, nothing. It exists so the
 * panel, the streaming renderer, and the composer can be built and tested end
 * to end before there is a model behind them. It replies with a short,
 * honest "not yet connected" message, streamed a few words at a time so the
 * rendering path that a real transport will use is actually exercised.
 *
 * ---
 * ## What wiring this up for real requires
 *
 * 1. **A server-side route, never a client-side model call.** Per
 *    `docs/WEB.md` §3.1 the session cookie is httpOnly and never reaches the
 *    browser, so a real `ChatTransport` calls a Next route handler
 *    (`app/api/chat/route.ts` or similar — outside this directory's
 *    ownership) which forwards to the Nest server, not a provider SDK
 *    imported here.
 * 2. **The Nest server already has the pieces**, per `docs/AI.md` and
 *    `apps/server/src/ai/`:
 *      - `router.ts` picks a model by *capability* (`'chat'`) with
 *        escalation — `glm-5.3` primary, `deepseek-v4-flash` excluded
 *        because it calls tools and then ignores their answer.
 *      - `tools.ts` (58 tests) is the part that actually matters: the
 *        assistant is NOT allowed to state a GST figure, a threshold, an ABN
 *        validity, a current rate, or a retention period from model
 *        knowledge — it must call `gst_on_purchase`, `gst_on_sale`,
 *        `tax_invoice_requirements`, `check_abn`, `current_rates`, or
 *        `retention_period` and relay what came back. A real transport must
 *        preserve that: tool results, not model claims, are what the UI
 *        should trust enough to render as `ChatCitation`s.
 * 3. **Streaming.** The provider is OpenAI-compatible (Ollama Cloud in dev,
 *    Bedrock Claude in production per D13), so the route handler should
 *    proxy an SSE or chunked stream and the transport's `onToken` callback
 *    maps directly onto that — this shell's `onToken` shape was chosen to
 *    make that a thin adapter, not a rewrite.
 * 4. **Tenant scoping.** `ChatTransportContext.tenantId` needs to be filled
 *    in from the signed-in session server-side (never trust a client-passed
 *    tenant id), because the tools above answer with figures that must not
 *    leak across tenants.
 * 5. **Never fall back offshore.** `docs/AI.md` §2.6: `BedrockClaudeProvider`
 *    throws rather than silently using the dev provider, because that would
 *    be an undisclosed cross-border transfer of AU tax data under APP 8. A
 *    real transport should surface that failure as a chat error message, not
 *    swallow it and answer anyway.
 */

const STUB_REPLY =
  "I'm not connected to anything yet — this is a shell. When I'm wired up, " +
  "figures like GST, tax-invoice thresholds and ABN checks will come from " +
  "the same validated tools that build your BAS, not from a guess. For now, " +
  "try the Support or Docs pages, or contact support directly.";

function chunk(text: string): string[] {
  // Word-by-word, keeping the leading space, so onToken exercises the same
  // "append this delta" contract a real token stream would.
  const words = text.split(' ');
  return words.map((word, i) => (i === 0 ? word : ` ${word}`));
}

export class StubChatTransport implements ChatTransport {
  /** Milliseconds between simulated tokens. Kept short; this is a UI proof, not a demo. */
  private readonly delayMs: number;

  constructor(delayMs = 18) {
    this.delayMs = delayMs;
  }

  async send(
    _history: ChatMessage[],
    _context: ChatTransportContext,
    events: ChatTransportEvents,
    signal?: AbortSignal,
  ): Promise<ChatMessage> {
    let content = '';
    for (const piece of chunk(STUB_REPLY)) {
      if (signal?.aborted) {
        return {
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          status: 'error',
          createdAt: new Date().toISOString(),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      content += piece;
      events.onToken(piece);
    }
    return {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      status: 'complete',
      createdAt: new Date().toISOString(),
      citations: [{ label: 'This shell is not connected to a model.', source: 'components/chat/stub-transport.ts' }],
    };
  }
}

export const stubChatTransport = new StubChatTransport();
