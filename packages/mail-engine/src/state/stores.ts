import { MailError } from "../model";
import type { Folder, FolderKey, MailClient, MailSummary, MessageDetail, MessageSummary, SafeHtml } from "../model";

// Framework-free stores behind the React hooks (src/react.ts). They hold the
// loading logic so it is testable in plain Node, and the hooks stay thin
// wrappers over useSyncExternalStore. A store loads while it has subscribers.

export interface Store<S> {
  getSnapshot(): S;
  subscribe(listener: () => void): () => void;
}

function toMailError(e: unknown): MailError {
  if (e instanceof MailError) return e;
  return new MailError("unavailable", e instanceof Error ? e.message : "unexpected error", { cause: e });
}

interface Base<S> extends Store<S> {
  set(next: S): void;
}

function createBase<S>(initial: S, hooks: { start(): void; stop(): void }): Base<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    set(next) {
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) hooks.start();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) hooks.stop();
      };
    },
  };
}

// ---- folders -----------------------------------------------------------------

export interface FoldersState {
  folders: Folder[];
  loading: boolean;
  error: MailError | null;
}

export interface FoldersStore extends Store<FoldersState> {
  refresh(): void;
}

export function createFoldersStore(client: MailClient): FoldersStore {
  let unwatch: (() => void) | null = null;
  let gen = 0;
  const base: Base<FoldersState> = createBase<FoldersState>(
    { folders: [], loading: true, error: null },
    {
      start() {
        refresh();
        unwatch = client.onChange(() => refresh());
      },
      stop() {
        unwatch?.();
        unwatch = null;
      },
    },
  );

  function refresh(): void {
    const mine = ++gen;
    const first = base.getSnapshot().folders.length === 0;
    if (first) base.set({ ...base.getSnapshot(), loading: true });
    client.folders().then(
      (folders) => {
        if (mine === gen) base.set({ folders, loading: false, error: null });
      },
      (e: unknown) => {
        if (mine === gen) base.set({ ...base.getSnapshot(), loading: false, error: toMailError(e) });
      },
    );
  }

  return { getSnapshot: base.getSnapshot, subscribe: base.subscribe, refresh };
}

// ---- message list -------------------------------------------------------------

export interface ListState {
  items: MessageSummary[];
  total: number;
  loading: boolean;
  error: MailError | null;
}

export interface ListStore extends Store<ListState> {
  loadMore(): void;
  refresh(): void;
}

export const LIST_PAGE_SIZE = 50;
const MAX_REFRESH = 200;

export function createMessageListStore(client: MailClient, source: FolderKey | { search: string }): ListStore {
  const empty = typeof source !== "string" && source.search.trim() === "";
  let unwatch: (() => void) | null = null;
  let gen = 0;
  let more = false;

  const fetchPage = (position: number, limit: number) =>
    typeof source === "string"
      ? client.list(source, { position, limit })
      : client.search(source.search, { position, limit });

  const base: Base<ListState> = createBase<ListState>(
    { items: [], total: 0, loading: !empty, error: null },
    {
      start() {
        if (empty) return;
        refresh();
        unwatch = client.onChange((what) => {
          if (what.messages || what.folders) refresh();
        });
      },
      stop() {
        unwatch?.();
        unwatch = null;
      },
    },
  );

  function refresh(): void {
    if (empty) return;
    const mine = ++gen;
    more = false;
    const current = base.getSnapshot();
    // Keep what the person has already scrolled to, up to a sane cap.
    const limit = Math.min(MAX_REFRESH, Math.max(LIST_PAGE_SIZE, current.items.length));
    if (current.items.length === 0) base.set({ ...current, loading: true });
    fetchPage(0, limit).then(
      (page) => {
        if (mine === gen) base.set({ items: page.items, total: page.total, loading: false, error: null });
      },
      (e: unknown) => {
        if (mine === gen) base.set({ ...base.getSnapshot(), loading: false, error: toMailError(e) });
      },
    );
  }

  function loadMore(): void {
    if (empty || more) return;
    const current = base.getSnapshot();
    if (current.loading || current.items.length >= current.total) return;
    more = true;
    const mine = gen;
    fetchPage(current.items.length, LIST_PAGE_SIZE).then(
      (page) => {
        more = false;
        if (mine !== gen) return;
        const have = new Set(base.getSnapshot().items.map((m) => m.id));
        const items = [...base.getSnapshot().items, ...page.items.filter((m) => !have.has(m.id))];
        base.set({ items, total: page.total, loading: false, error: null });
      },
      (e: unknown) => {
        more = false;
        if (mine === gen) base.set({ ...base.getSnapshot(), error: toMailError(e) });
      },
    );
  }

  return { getSnapshot: base.getSnapshot, subscribe: base.subscribe, refresh, loadMore };
}

// ---- one message ---------------------------------------------------------------

export interface MessageState {
  message: MessageDetail | null;
  loading: boolean;
  error: MailError | null;
}

export function createMessageStore(client: MailClient, id: string): Store<MessageState> {
  let unwatch: (() => void) | null = null;
  let gen = 0;
  const base: Base<MessageState> = createBase<MessageState>(
    { message: null, loading: true, error: null },
    {
      start() {
        load();
        unwatch = client.onChange((what) => {
          if (what.messages) load();
        });
      },
      stop() {
        unwatch?.();
        unwatch = null;
      },
    },
  );

  function load(): void {
    const mine = ++gen;
    client.get(id).then(
      (message) => {
        if (mine === gen) base.set({ message, loading: false, error: null });
      },
      (e: unknown) => {
        if (mine === gen) base.set({ ...base.getSnapshot(), loading: false, error: toMailError(e) });
      },
    );
  }

  return { getSnapshot: base.getSnapshot, subscribe: base.subscribe };
}

// ---- sanitised HTML -------------------------------------------------------------

export interface SafeHtmlState {
  safe: SafeHtml | null;
  loading: boolean;
  error: MailError | null;
}

export function createSafeHtmlStore(client: MailClient, id: string): Store<SafeHtmlState> {
  let started = false;
  const base: Base<SafeHtmlState> = createBase<SafeHtmlState>(
    { safe: null, loading: true, error: null },
    {
      start() {
        // The sanitised body of a message does not change: fetch once.
        if (started) return;
        started = true;
        client.safeHtml(id).then(
          (safe) => base.set({ safe, loading: false, error: null }),
          (e: unknown) => {
            started = false;
            base.set({ safe: null, loading: false, error: toMailError(e) });
          },
        );
      },
      stop() {},
    },
  );
  return { getSnapshot: base.getSnapshot, subscribe: base.subscribe };
}

// ---- summary ---------------------------------------------------------------------

export interface SummaryState {
  summary: MailSummary | null;
  loading: boolean;
}

export function createSummaryStore(client: MailClient, locale: string | undefined): Store<SummaryState> {
  let started = false;
  const base: Base<SummaryState> = createBase<SummaryState>(
    { summary: null, loading: true },
    {
      start() {
        if (started) return;
        started = true;
        client.summary(locale).then(
          (summary) => base.set({ summary, loading: false }),
          () => {
            started = false;
            base.set({ summary: null, loading: false });
          },
        );
      },
      stop() {},
    },
  );
  return { getSnapshot: base.getSnapshot, subscribe: base.subscribe };
}

/** A store that never loads: for hooks given a null id or disabled. */
export function idleStore<S>(state: S): Store<S> {
  return { getSnapshot: () => state, subscribe: () => () => {} };
}
