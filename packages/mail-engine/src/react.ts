// React bindings. Imports only "react": the same hooks run in React DOM (web)
// and React Native. The loading logic lives in ./state/stores (plain TypeScript).

import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from "react";
import type { JSX, ReactNode } from "react";
import { toSandboxDocument } from "./html";
import type {
  Folder,
  FolderKey,
  MailClient,
  MailError,
  MailSummary,
  MessageDetail,
  MessageSummary,
  SafeHtml,
} from "./model";
import {
  createFoldersStore,
  createMessageListStore,
  createMessageStore,
  createSafeHtmlStore,
  createSummaryStore,
  idleStore,
} from "./state/stores";
import type { FoldersStore, Store } from "./state/stores";

const MailContext = createContext<MailClient | null>(null);

export function MailProvider(props: { client: MailClient; children: ReactNode }): JSX.Element {
  return createElement(MailContext.Provider, { value: props.client }, props.children);
}

export function useMailClient(): MailClient {
  const client = useContext(MailContext);
  if (!client) throw new Error("useMailClient must be used inside <MailProvider>");
  return client;
}

function useStore<S>(store: Store<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// One folders store per client, shared by every component that shows counts.
const foldersStores = new WeakMap<MailClient, FoldersStore>();

function foldersStoreFor(client: MailClient): FoldersStore {
  let store = foldersStores.get(client);
  if (!store) {
    store = createFoldersStore(client);
    foldersStores.set(client, store);
  }
  return store;
}

export function useFolders(): { folders: Folder[]; loading: boolean; error: MailError | null; refresh(): void } {
  const client = useMailClient();
  const store = foldersStoreFor(client);
  const state = useStore(store);
  return useMemo(
    () => ({ folders: state.folders, loading: state.loading, error: state.error, refresh: () => store.refresh() }),
    [state, store],
  );
}

export function useMessageList(source: FolderKey | { search: string }): {
  items: MessageSummary[];
  total: number;
  loading: boolean;
  error: MailError | null;
  loadMore(): void;
  refresh(): void;
} {
  const client = useMailClient();
  const key = typeof source === "string" ? source : `search:${source.search}`;
  // `key` stands in for `source` so an inline `{ search }` object does not rebuild the store.
  const store = useMemo(() => createMessageListStore(client, source), [client, key]);
  const state = useStore(store);
  return useMemo(
    () => ({
      items: state.items,
      total: state.total,
      loading: state.loading,
      error: state.error,
      loadMore: () => store.loadMore(),
      refresh: () => store.refresh(),
    }),
    [state, store],
  );
}

const NO_MESSAGE = idleStore({ message: null as MessageDetail | null, loading: false, error: null as MailError | null });

export function useMessage(id: string | null): { message: MessageDetail | null; loading: boolean; error: MailError | null } {
  const client = useMailClient();
  const store = useMemo(() => (id === null ? NO_MESSAGE : createMessageStore(client, id)), [client, id]);
  return useStore(store);
}

const NO_HTML = idleStore({ safe: null as SafeHtml | null, loading: false, error: null as MailError | null });

export function useSandboxDocument(
  id: string | null,
  enabled: boolean,
  opts?: { dark?: boolean },
): { doc: string | null; remoteImagesBlocked: number; loading: boolean; error: MailError | null } {
  const client = useMailClient();
  const active = enabled && id !== null;
  const store = useMemo(() => (active && id !== null ? createSafeHtmlStore(client, id) : NO_HTML), [client, id, active]);
  const state = useStore(store);
  const dark = opts?.dark === true;
  return useMemo(
    () => ({
      doc: state.safe ? toSandboxDocument(state.safe, { dark }) : null,
      remoteImagesBlocked: state.safe?.remoteImagesBlocked ?? 0,
      loading: state.loading,
      error: state.error,
    }),
    [state, dark],
  );
}

/** Unread count of a folder (default Inbox), kept live. 0 until folders have loaded. */
export function useUnreadCount(folder: FolderKey = "inbox"): number {
  const client = useMailClient();
  const state = useStore(foldersStoreFor(client));
  return state.folders.find((f) => f.key === folder)?.unread ?? 0;
}

export function useMailSummary(locale?: string): { summary: MailSummary | null; loading: boolean } {
  const client = useMailClient();
  const store = useMemo(() => createSummaryStore(client, locale), [client, locale]);
  return useStore(store);
}
