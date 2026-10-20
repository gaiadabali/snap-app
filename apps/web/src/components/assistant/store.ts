/**
 * What the assistant remembers.
 *
 * sessionStorage `snap-assistant:v1`: the conversation (survives a reload and
 * a refresh of the page, dies with the tab). localStorage
 * `snap-assistant:teaser`: that the visitor dismissed the teaser.
 * sessionStorage `snap-assistant:tz`: that the teaser has been shown this tab.
 * Every access can throw (private windows, blocked storage), so every access is
 * wrapped and the widget works, just without memory, when they do.
 */
import type { Cta } from './config';

export interface Source {
  title: string;
  url: string;
}

export interface Msg {
  role: 'user' | 'assistant';
  text: string;
  /** A local action the visitor took (a starter): shown, but never sent to the model. */
  local?: boolean;
  /** Not a model answer: an error, or a call-to-action card. */
  kind?: 'error' | 'cta';
  cta?: Cta;
  sources?: Source[];
  chips?: string[];
  /** An error the visitor may retry. */
  retry?: boolean;
  /** The answer was cut short by the stop button. */
  stopped?: boolean;
}

export interface State {
  sid: string;
  open: boolean;
  /** The chat has been opened at least once this session: no teaser after that. */
  opened: boolean;
  msgs: Msg[];
}

export const KEY = 'snap-assistant:v1';
const TEASER = 'snap-assistant:teaser';
const SHOWN = 'snap-assistant:tz';
const CAP = 40;

/**
 * A v4 UUID for the chat session. `randomUUID` needs a secure context (it is
 * missing on plain http and in older browsers); `getRandomValues` is there in
 * every browser, so the fallback is still cryptographically random rather
 * than `Math.random()` (CodeQL js/insecure-randomness).
 */
const uuid = (): string => {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const blank = (): State => ({ sid: uuid(), open: false, opened: false, msgs: [] });

export function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<State>;
      if (typeof s.sid === 'string' && Array.isArray(s.msgs)) return { ...blank(), ...s } as State;
    }
  } catch {
    /* blocked or corrupt: start fresh */
  }
  return blank();
}

export function save(s: State): void {
  try {
    if (s.msgs.length > CAP) s.msgs = s.msgs.slice(-CAP);
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nothing to do: the conversation just will not survive a reload */
  }
}

export const teaserDismissed = (): boolean => {
  try {
    return localStorage.getItem(TEASER) === '1' || sessionStorage.getItem(SHOWN) === '1';
  } catch {
    return false;
  }
};

export const markTeaserShown = (): void => {
  try {
    sessionStorage.setItem(SHOWN, '1');
  } catch {
    /* ignore */
  }
};

export const dismissTeaser = (): void => {
  try {
    localStorage.setItem(TEASER, '1');
  } catch {
    /* ignore */
  }
};
