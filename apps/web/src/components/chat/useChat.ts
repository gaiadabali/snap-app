'use client';

import { useCallback, useRef, useState } from 'react';

import { stubChatTransport } from './stub-transport';
import type { ChatMessage, ChatTransport } from './types';

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  content:
    "Hi — I'm the Snap Apps assistant shell. I can't answer anything yet; " +
    'I have no model behind me. Ask me something to see how this will feel.',
  status: 'complete',
  createdAt: new Date(0).toISOString(),
};

/**
 * Conversation state and the send loop, independent of the transport.
 *
 * Defaults to the stub so every consumer works out of the box; pass a real
 * `ChatTransport` once one exists (see `stub-transport.ts` for what that
 * requires) and nothing else in this file changes.
 */
export function useChat(transport: ChatTransport = stubChatTransport) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [sending, setSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: trimmed,
        status: 'complete',
        createdAt: new Date().toISOString(),
      };
      const assistantId = crypto.randomUUID();
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const nextHistory = [...messages, userMessage];
      setMessages([...nextHistory, placeholder]);
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const finished = await transport.send(
          nextHistory,
          {},
          {
            onToken: (delta) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, status: 'streaming', content: m.content + delta }
                    : m,
                ),
              );
            },
          },
          controller.signal,
        );
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...finished, id: assistantId } : m)));
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, status: 'error', content: m.content || 'Something went wrong sending that.' }
              : m,
          ),
        );
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [messages, sending, transport],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, send, sending, cancel };
}
