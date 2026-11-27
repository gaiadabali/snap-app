import type { MailMailbox, MailSettingsView } from '@snap/api-contract';
import type { MailClient } from '@snap/mail-engine';
import { MailProvider } from '@snap/mail-engine/react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { createAppMailClient } from '@/lib/mail-client';

/**
 * What the Mail screens know about the mailbox, shared by all of them: the address, the
 * quota, and the settings (which the settings screen changes, and the list reads for the
 * alerts line).
 */
export interface MailAccount {
  address: string;
  quota?: MailMailbox['quota'];
  settings: MailSettingsView;
  setSettings: (next: MailSettingsView) => void;
}

const AccountContext = createContext<MailAccount | null>(null);

export function useMailAccount(): MailAccount {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useMailAccount must be used inside <MailRoot>');
  return account;
}

/**
 * One mail client for every Mail screen (the list, the reader, compose, settings), so they
 * share one token, one folders store and one live poll. The Mail stack mounts this once.
 * The client is created lazily by the engine: nothing is fetched until a screen subscribes.
 *
 * `createClient` exists for tests and the demo; the app passes nothing.
 */
export function MailRoot({
  address,
  quota,
  settings: initialSettings,
  children,
  createClient = createAppMailClient,
}: {
  address: string;
  quota?: MailMailbox['quota'] | undefined;
  settings: MailSettingsView;
  children: ReactNode;
  createClient?: () => MailClient;
}) {
  const [client] = useState<MailClient>(createClient);
  const [settings, setSettings] = useState<MailSettingsView>(initialSettings);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // React StrictMode runs this cleanup and the effect again on the same client; only a
      // real unmount leaves `mounted` false by the time this timer fires.
      setTimeout(() => {
        if (!mounted.current) client.close();
      }, 0);
    };
  }, [client]);

  const account = useMemo<MailAccount>(
    () => ({ address, ...(quota ? { quota } : {}), settings, setSettings }),
    [address, quota, settings],
  );

  return (
    <AccountContext.Provider value={account}>
      <MailProvider client={client}>{children}</MailProvider>
    </AccountContext.Provider>
  );
}
