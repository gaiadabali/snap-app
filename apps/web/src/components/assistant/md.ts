/**
 * A small, SAFE markdown renderer for the assistant's answers.
 *
 * It builds DOM nodes and never touches innerHTML, so nothing the model writes
 * can become markup. It knows paragraphs, line breaks, `**bold**`, `*em*`,
 * `-` / `1.` lists, and links, and it only makes a link clickable when the
 * target is site-relative (`/…`) or `mailto:`;
 * anything else renders as its plain label.
 *
 * INCREMENTAL. While an answer streams, the reader sees every construct as it
 * is being written: an unclosed `**bold` is already bold, `[Android ap` already
 * shows its label, and the half-typed `](/pri` never shows. Only the last block
 * is re-rendered on a delta (earlier blocks are cached by their source text).
 *
 * THE FADE. Each rendered text character remembers when it first appeared
 * (`births`); characters younger than FADE_MS are wrapped in a span whose
 * animation delay is negative by their age. Re-rendering the last block every
 * frame therefore never restarts a fade, it resumes it where it was.
 */

export const FADE_MS = 240;

interface Ctx {
  /** Rendered text characters before this block, so births line up across blocks. */
  pos: number;
  births: number[];
  now: number;
  /** Fade freshly arrived text (off for finished or restored messages). */
  fade: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

/** The only targets a link may have. Everything else is shown as text. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const u = raw.trim();
  if (!u) return null;
  if (u.toLowerCase() === SUPPORT_MAILTO) return { href: SUPPORT_MAILTO, external: false };
  const path = (u.split('#')[0] ?? '').replace(/\/+$/, '') || '/';
  const hit = SITE_PATHS.find((p) => p === path);
  return hit ? { href: hit, external: false } : null;
}

/**
 * The pages a link may point to (docs/ASSISTANT.md §9) and the one address.
 *
 * The href is always one of THESE constants, never the text it was matched
 * from, so nothing a model or a visitor wrote can become a link target —
 * not even a harmless one. (The earlier pattern-based check allowed only
 * same-site paths and mailto:, but it handed the matched text itself to
 * `a.href`, which is the flow CodeQL's js/xss-through-dom rule reports.)
 * Anchors are dropped: a link lands on the page.
 */
const SITE_PATHS = [
  '/',
  '/features',
  '/how-it-works',
  '/pricing',
  '/download',
  '/support',
  '/docs',
  '/docs/getting-started',
  '/docs/capturing-receipts',
  '/docs/reviewing-corrections',
  '/docs/confidence-and-flags',
  '/docs/ledger-and-posted',
  '/docs/data-retention',
  '/legal/privacy',
  '/legal/terms',
  '/legal/security',
  '/register',
  '/sign-in',
] as const;
const SUPPORT_MAILTO = 'mailto:support@snapapps.com.au';

function addText(parent: Node, str: string, c: Ctx): void {
  const start = c.pos;
  c.pos += str.length;
  if (!c.fade) {
    parent.appendChild(document.createTextNode(str));
    return;
  }
  let i = 0;
  while (i < str.length) {
    c.births[start + i] ??= c.now;
    const b = c.births[start + i]!;
    let j = i + 1;
    while (j < str.length) {
      c.births[start + j] ??= c.now;
      if (c.births[start + j] !== b) break;
      j++;
    }
    const seg = str.slice(i, j);
    const age = c.now - b;
    if (age >= FADE_MS) parent.appendChild(document.createTextNode(seg));
    else {
      const s = el('span', 'sa-f');
      s.style.animationDelay = `${-Math.round(age)}ms`;
      s.textContent = seg;
      parent.appendChild(s);
    }
    i = j;
  }
}

/** Index of the closing `mark` for an emphasis opened at `from`, or -1. */
function closer(s: string, from: number, mark: string): number {
  let k = from;
  for (;;) {
    k = s.indexOf(mark, k);
    if (k === -1) return -1;
    const before = s[k - 1] ?? '';
    const after = s[k + mark.length] ?? '';
    // `*` must not be half of a `**`, and a closer is never preceded by a space.
    if (mark === '*' && (after === '*' || before === '*')) {
      k += 1;
      continue;
    }
    if (k > from && !/\s/.test(before)) return k;
    k += mark.length;
  }
}

/** `live`: `s` is the tail of the text still being written, so open constructs are shown open. */
function inline(s: string, parent: Node, c: Ctx, live: boolean): void {
  let i = 0;
  let buf = '';
  const flush = (): void => {
    if (buf) addText(parent, buf, c);
    buf = '';
  };

  while (i < s.length) {
    const ch = s[i]!;

    if (ch === '*') {
      const mark = s[i + 1] === '*' ? '**' : '*';
      const from = i + mark.length;
      if (from >= s.length) {
        // Only the marker has arrived so far: show nothing yet while live.
        if (live) break;
        buf += mark;
        i = from;
        continue;
      }
      if (!/\s/.test(s[from]!)) {
        const end = closer(s, from, mark);
        if (end !== -1) {
          flush();
          const n = el(mark === '**' ? 'strong' : 'em');
          inline(s.slice(from, end), n, c, false);
          parent.appendChild(n);
          i = end + mark.length;
          continue;
        }
        if (live) {
          flush();
          const n = el(mark === '**' ? 'strong' : 'em');
          inline(s.slice(from), n, c, true);
          parent.appendChild(n);
          i = s.length;
          break;
        }
      }
      buf += mark;
      i = from;
      continue;
    }

    if (ch === '[') {
      const j = s.indexOf(']', i + 1);
      if (j === -1) {
        // `[Android ap`: the label reads as text until the bracket closes.
        if (live) {
          i += 1;
          continue;
        }
        buf += ch;
        i += 1;
        continue;
      }
      const label = s.slice(i + 1, j);
      if (s[j + 1] === '(') {
        const k = s.indexOf(')', j + 2);
        if (k === -1) {
          if (live) {
            flush();
            inline(label, parent, c, false);
            i = s.length;
            break;
          }
        } else {
          const target = safeHref(s.slice(j + 2, k));
          flush();
          if (target) {
            const a = el('a', 'sa-lnk');
            a.href = target.href;
            if (target.external) {
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
            }
            inline(label, a, c, false);
            parent.appendChild(a);
          } else inline(label, parent, c, false);
          i = k + 1;
          continue;
        }
      } else if (live && j + 1 === s.length) {
        // `[label]` with the target still to come.
        flush();
        inline(label, parent, c, false);
        i = s.length;
        break;
      }
      buf += ch;
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

type Line = { t: 'ul' | 'ol' | 'p' | 'h'; n?: number; text: string };

function classify(line: string): Line {
  let m = BULLET.exec(line);
  if (m) return { t: 'ul', text: m[1]! };
  m = NUMBER.exec(line);
  if (m) return { t: 'ol', n: Number(m[1]), text: m[2]! };
  m = HEADING.exec(line);
  if (m) return { t: 'h', text: m[1]! };
  return { t: 'p', text: line.trim() };
}

/** Split an answer into block sources: paragraphs, lists and headings. */
export function parseBlocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let kind = '';
  const end = (): void => {
    if (cur.length) out.push(cur.join('\n'));
    cur = [];
    kind = '';
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) {
      end();
      continue;
    }
    const l = classify(raw);
    if (l.t === 'h') {
      end();
      out.push(raw);
      continue;
    }
    const isItem = l.t === 'ul' || l.t === 'ol';
    if (isItem) {
      if (kind !== l.t) end();
      kind = l.t;
    } else if (kind === 'ul' || kind === 'ol') {
      // An unindented line after a list ends it; an indented one continues the item.
      if (!/^\s+/.test(raw)) end();
    }
    cur.push(raw);
  }
  end();
  return out;
}

function renderBlock(src: string, c: Ctx, live: boolean): { el: HTMLElement; count: number } {
  const start = c.pos;
  const lines = src.split('\n');
  const first = classify(lines[0]!);
  let root: HTMLElement;
  let tail: HTMLElement;

  if (first.t === 'ul' || first.t === 'ol') {
    root = el(first.t);
    if (first.t === 'ol' && first.n && first.n > 1) (root as HTMLOListElement).start = first.n;
    let item: HTMLLIElement | null = null;
    let itemText = '';
    const flushItem = (isLast: boolean): void => {
      if (item) inline(itemText, item, c, live && isLast);
    };
    lines.forEach((ln) => {
      const l = classify(ln);
      if (l.t === first.t) {
        flushItem(false);
        item = el('li');
        root.appendChild(item);
        itemText = l.text;
      } else itemText += ` ${ln.trim()}`;
    });
    flushItem(true);
    tail = (root.lastElementChild as HTMLElement | null) ?? root;
  } else if (first.t === 'h') {
    root = el('p', 'sa-h');
    const st = el('strong');
    inline(first.text, st, c, live);
    root.appendChild(st);
    tail = root;
  } else {
    root = el('p');
    lines.forEach((ln, idx) => {
      if (idx) root.appendChild(el('br'));
      inline(ln.trim(), root, c, live && idx === lines.length - 1);
    });
    tail = root;
  }
  if (live) tail.appendChild(el('span', 'sa-caret'));
  return { el: root, count: c.pos - start };
}

export interface Md {
  /** Render `text`; `live` while it is still being written (caret + fade). */
  set(text: string, live: boolean): void;
  /** Forget everything (the message was replaced). */
  reset(): void;
}

export function createMd(container: HTMLElement): Md {
  let blocks: { src: string; count: number; el: HTMLElement; live: boolean }[] = [];
  let births: number[] = [];
  /** Once an answer has streamed, its last fades are allowed to finish in the final render. */
  let streamed = false;

  return {
    reset() {
      container.textContent = '';
      blocks = [];
      births = [];
      streamed = false;
    },
    set(text, live) {
      if (live) streamed = true;
      const srcs = parseBlocks(text);
      const now = performance.now();
      let pos = 0;
      srcs.forEach((src, i) => {
        const last = i === srcs.length - 1;
        const isLive = live && last;
        const prev = blocks[i];
        if (prev && prev.src === src && !isLive && !prev.live) {
          pos += prev.count;
          return;
        }
        const c: Ctx = { pos, births, now, fade: streamed };
        const r = renderBlock(src, c, isLive);
        if (prev) container.replaceChild(r.el, prev.el);
        else container.appendChild(r.el);
        blocks[i] = { src, count: r.count, el: r.el, live: isLive };
        pos += r.count;
      });
      while (blocks.length > srcs.length) container.removeChild(blocks.pop()!.el);
      if (births.length > pos) births.length = pos;
    },
  };
}
