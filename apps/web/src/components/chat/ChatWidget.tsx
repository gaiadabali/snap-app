'use client';

import { useState } from 'react';

import { ChatLauncher } from './ChatLauncher';
import { ChatPanel } from './ChatPanel';
import type { ChatTransport } from './types';
import { useChat } from './useChat';

/**
 * The whole assistant shell, self-contained.
 *
 * Drop `<ChatWidget />` anywhere in a layout and it renders its own launcher
 * button and slide-over panel — it owns its open/closed state and its own
 * conversation state via `useChat`. It is mounted today inside the docs,
 * legal, and support layouts this agent owns; it is NOT mounted in the root
 * or marketing layout, since those are owned elsewhere — whoever owns that
 * layout can add one `<ChatWidget />` to make it appear site-wide.
 *
 * `transport` defaults to the stub (`stub-transport.ts`). Passing a real
 * `ChatTransport` here is the entire integration surface once one exists —
 * nothing else in this directory needs to change.
 */
export function ChatWidget({ transport }: { transport?: ChatTransport }) {
  const [open, setOpen] = useState(false);
  const { messages, send, sending, cancel } = useChat(transport);

  return (
    <>
      <ChatLauncher open={open} onClick={() => setOpen((v) => !v)} />
      <ChatPanel
        open={open}
        onClose={() => setOpen(false)}
        messages={messages}
        onSend={send}
        onCancel={cancel}
        sending={sending}
      />
    </>
  );
}
