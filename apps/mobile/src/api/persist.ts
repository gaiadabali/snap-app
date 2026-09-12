import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  Bill,
  Budget,
  BusinessSettings,
  Connection,
  DocumentView,
  Goal,
  Invitation,
  Invoice,
  Item,
  MemberRole,
  Payment,
  StockMovement,
  Trip,
} from './types';

/**
 * Session state that survives a restart.
 *
 * Without this the app is a slideshow: add an invoice, record a payment,
 * adjust a budget, reload, and none of it happened. That is fine for a
 * screenshot and indefensible in front of anyone who taps around.
 *
 * What is stored is the DELTA, not the world. The 919 fixture documents are
 * already in the bundle, so re-serialising them into storage would cost about
 * a megabyte per write to record nothing. Instead documents are kept as an
 * overrides map (what a human changed) plus the handful captured on this
 * device — and everything else is small enough to store whole.
 *
 * Writes are debounced and fire-and-forget. Persistence must never make the UI
 * wait, and a storage failure must never lose the in-memory state that is
 * already on screen: the user's next action matters more than the record of
 * their last one.
 */

const KEY = 'snap.state.v1';
const DEBOUNCE_MS = 400;

export type Persisted = {
  v: 1;
  /** Per-document changes: corrections, confirmations, visibility, lines. */
  docOverrides: Record<string, Partial<DocumentView>>;
  /** Captured on this device, so not in the fixture at all. */
  newDocs: DocumentView[];
  /** Rejected or deleted; filtered out of every list. */
  removedDocIds: string[];
  budgets: Budget[];
  invoices: Invoice[];
  payments: Payment[];
  bills: Bill[];
  trips: Trip[];
  items: Item[];
  movements: StockMovement[];
  goals: Goal[];
  connections: Connection[];
  settings: BusinessSettings | null;
  members: Array<{
    workspaceId: string;
    userId: string;
    displayName: string;
    email: string | null;
    role: MemberRole;
    joinedAt: string;
    lastActiveAt: string | null;
  }>;
  invitations: Invitation[];
  /** Which demo account is signed in, and whether anyone is. */
  signedInUserId?: string;
  signedIn?: boolean;
  inactiveCategories: string[];
  customCategories: string[];
  extraWorkspaces: Array<{ id: string; name: string; kind: 'business' | 'personal' }>;
};

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: (() => Persisted) | null = null;

/**
 * Strips a document's SERVER-ISSUED image URLs before it crosses the storage
 * boundary, in either direction.
 *
 * `imageUrl` and every `pages[].imageUrl` are short-TTL signed URLs —
 * `/v1/images/:token`, ~15 minutes by default (`IMAGE_TTL_SECONDS`) — minted
 * fresh on each document fetch (§8 of the multi-page capture contract).
 * AsyncStorage exists specifically to survive an app restart, which a
 * 15-minute token does not: written as-is, today's URL is tomorrow's 404.
 *
 * `localImageUri` is deliberately left alone. It is a device-local file path
 * from a capture on THIS device, not a token the server can expire, and
 * `receipt.tsx` already prefers it over `imageUrl` for exactly this reason —
 * stripping `imageUrl` here still leaves a just-captured single-page receipt
 * showing its real photo after a restart, via `localImageUri`.
 *
 * Applied on both write and read: on write so a token never reaches disk in
 * the first place, and on read as a second line of defence against anything
 * already written before this existed, or written by a future caller of
 * `persist()` that forgets. A caller that trusts a rehydrated `imageUrl` is a
 * caller that will show a broken image the first time it is a minute late;
 * the facsimile placeholder `receipt.tsx` already renders for an empty
 * `imageUrl`/`pages[].imageUrl` is the correct fallback, not a real fetch.
 */
function stripImageUrls(doc: DocumentView): DocumentView {
  return {
    ...doc,
    imageUrl: null,
    pages: doc.pages.map((page) => ({ ...page, imageUrl: '' })),
  };
}

/** Same idea as `stripImageUrls`, for the partial diffs in `docOverrides`. */
function stripImageUrlsFromOverride(diff: Partial<DocumentView>): Partial<DocumentView> {
  const next = { ...diff };
  if ('imageUrl' in next) next.imageUrl = null;
  if (next.pages) next.pages = next.pages.map((page) => ({ ...page, imageUrl: '' }));
  return next;
}

function sanitize(state: Persisted): Persisted {
  return {
    ...state,
    newDocs: (state.newDocs ?? []).map(stripImageUrls),
    docOverrides: Object.fromEntries(
      Object.entries(state.docOverrides ?? {}).map(([id, diff]) => [
        id,
        stripImageUrlsFromOverride(diff),
      ]),
    ),
  };
}

/** Reads the stored delta. Returns null on a first run, or on any fault. */
export async function loadPersisted(): Promise<Persisted | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    // A version mismatch is discarded rather than migrated: this is demo
    // state, and half-applying an old shape is worse than starting clean.
    if (parsed?.v !== 1) return null;
    // Never trust an image URL read back off disk — see `stripImageUrls`.
    return sanitize(parsed);
  } catch {
    return null;
  }
}

/**
 * Queues a save. Safe to call on every mutation.
 *
 * `snapshot` is a thunk so the caller does not build the payload on a
 * keystroke — only the last one before the timer fires is ever serialised.
 */
export function persist(snapshot: () => Persisted): void {
  pending = snapshot;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const take = pending;
    pending = null;
    if (!take) return;
    try {
      // Never write an image URL to disk — see `stripImageUrls`.
      const json = JSON.stringify(sanitize(take()));
      void AsyncStorage.setItem(KEY, json).catch(() => {});
    } catch {
      /* a value that will not serialise must not break the app */
    }
  }, DEBOUNCE_MS);
}

/** Forgets everything the demo has changed, back to the shipped fixture. */
export async function clearPersisted(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* nothing to do; the caller reloads either way */
  }
}
