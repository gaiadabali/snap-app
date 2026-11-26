'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createMailClient } from '@snap/mail-engine';
import type { MailClient } from '@snap/mail-engine';
import { MailProvider } from '@snap/mail-engine/react';

import { fetchMailSession } from '@/lib/panels/mail-api';
import { MAIL_BASE } from '@/lib/panels/mail-routes';

/**
 * One mail client for the whole `/app` panel.
 *
 * The individual layout mounts this when the person has a mailbox, above the shell, so
 * the sidebar's unread badge and the mail screens share the same engine client: one
 * token, one folders store, one live stream. The client is created lazily by the
 * engine (nothing is fetched until a hook subscribes), so rendering this costs nothing
 * on a page that shows no mail.
 *
 * `createClient` exists for the development preview, which passes the in-memory client.
 * The real route never passes it (a function cannot cross from a server component).
 */
interface RootValue {
  client: MailClient;
  /** Where the mail screens live: `/app/mail`, or `/mail-preview` in development. */
  base: string;
}

const RootContext = createContext<RootValue | null>(null);

/** `null` outside a mailbox owner's panel (no mailbox, impersonation, unlinked). */
export function useMailRoot(): RootValue | null {
  return useContext(RootContext);
}

export function useMailBase(): string {
  return useContext(RootContext)?.base ?? MAIL_BASE;
}

const defaultClient = (): MailClient => createMailClient({ getSession: fetchMailSession });

export function MailRoot({
  children,
  createClient = defaultClient,
  base = MAIL_BASE,
}: {
  children: ReactNode;
  createClient?: () => MailClient;
  base?: string;
}) {
  const [client] = useState<MailClient>(createClient);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React StrictMode runs this cleanup and the effect again on the same client; only
      // a real unmount leaves `mounted` false by the time this timer fires.
      setTimeout(() => {
        if (!mounted.current) client.close();
      }, 0);
    };
  }, [client]);

  const [value] = useState<RootValue>(() => ({ client, base }));
  return (
    <RootContext.Provider value={value}>
      <MailProvider client={client}>{children}</MailProvider>
    </RootContext.Provider>
  );
}
