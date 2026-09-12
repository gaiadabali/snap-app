/**
 * The chat shell's data contract.
 *
 * This file is the seam the SHELL is built against. Nothing in `components/chat`
 * imports a model provider, and nothing here ever will — see `stub-transport.ts`
 * for what is deliberately not done, and the header comment on `ChatWidget.tsx`
 * for what wiring this up for real requires.
 */

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessageStatus =
  /** Waiting on the transport; nothing has arrived yet. */
  | 'pending'
  /** Tokens are arriving. Render what is there and keep listening. */
  | 'streaming'
  /** Finished normally. */
  | 'complete'
  /** The transport failed or was aborted. `content` may be partial. */
  | 'error';

/**
 * A citation attached to an assistant message.
 *
 * Mirrors the shape `apps/server/src/ai/tools.ts` already returns
 * (`ToolResult.source`) — a tool-backed answer names the rule it came from,
 * because the whole point of the tools layer is that a figure in this chat
 * must be traceable to something other than the model's own claim.
 */
export type ChatCitation = {
  label: string;
  source: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status: ChatMessageStatus;
  createdAt: string;
  citations?: ChatCitation[];
};

/**
 * What a transport needs to know about who is asking.
 *
 * Kept minimal and optional on purpose: this shell renders on marketing pages
 * where nobody is signed in, and the real transport (see ChatWidget.tsx) will
 * need to add whatever server-side identity it fetches — never a token, which
 * per docs/WEB.md §3.1 never reaches the browser at all.
 */
export type ChatTransportContext = {
  tenantId?: string;
  /** ISO locale, so a future real transport can localise a phrased answer. */
  locale?: string;
};

export type ChatTransportEvents = {
  /** Called for every incremental chunk of the assistant's reply. */
  onToken: (delta: string) => void;
};

/**
 * The interface a real transport implements.
 *
 * `send` takes the whole conversation (the transport decides how much history
 * to forward) and streams the assistant's reply back token-by-token via
 * `onToken`, resolving with the finished message. An `AbortSignal` lets the
 * composer cancel a send — e.g. the panel closes mid-reply.
 */
export interface ChatTransport {
  send(
    history: ChatMessage[],
    context: ChatTransportContext,
    events: ChatTransportEvents,
    signal?: AbortSignal,
  ): Promise<ChatMessage>;
}
