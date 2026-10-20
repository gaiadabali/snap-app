import type { Facts } from './facts.js';
import { defaultCta, type Cta } from './intent.js';
import { findAmounts, findPercents, keyOf } from './money.js';
import { safeAnswer, type Actions } from './prompt.js';
import { allowedSiteHref, SITE_HOSTS, SITE_PAGES, sitePath, ALLOWED_PATHS } from './site.js';

/**
 * The output guard: a streaming filter between the model and the visitor
 * (docs/ASSISTANT.md §5, §7), ported from Tunas.
 *
 * The model's text arrives in arbitrary pieces. The filter holds back the tail
 * that could still turn into something unsafe (a half-written link, an amount
 * arriving digit by digit, a `[[directive]]`), cleans what is complete, and
 * only then lets it out. Nothing is shown and then found to be wrong, with one
 * exception by design: when the COMPLETE text so far states an unverified
 * amount or a guarantee, the filter stops the model and the whole answer is
 * replaced (`replace`). The visitor sees a few words swap for a true answer,
 * never the false one.
 *
 *   links      only §9 site paths (anchors kept) and mailto: the support
 *              address; anything else keeps its words and loses its target
 *   urls       bare foreign URLs are removed; this site's become paths
 *   contacts   any other email address or phone number becomes the support address
 *   money      any dollar/cent amount not in FACTS ∪ VERIFIED ∪ the visitor's
 *              own messages → replace; percentages likewise
 *   promises   unnegated "guarantee", "promise", "100% accurate", "never wrong" → replace
 *   markup     HTML, images and code fences removed; # headings become bold
 *   runaway    over 3,200 characters, the answer stops
 *   [[next: a | b]] and [[cta: app|start|human]] become the answer's actions
 */

/** Longest held tail before it is released anyway (it was not a link after all). */
const MAX_HOLD = 400;
/** A runaway answer is cut here. */
export const MAX_CHARS = 3200;

/* ------------------------------------------------------------------ */
/* Promises                                                            */
/* ------------------------------------------------------------------ */

const PROMISES: Array<{ re: RegExp; checkInside: boolean }> = [
  { re: /\b(?:guarantee[sd]?|guaranteeing)\b/gi, checkInside: true },
  { re: /\b(?:promise[sd]?|promising)\b/gi, checkInside: true },
  { re: /\b100\s?%\s?(?:accurate|accuracy|correct|right|reliable|of the time|guaranteed|sure|certain)\b/gi, checkInside: true },
  { re: /\b(?:always|perfectly|completely) accurate\b|\bperfect accuracy\b|\bflawless(?:ly)?\b|\berror[- ]free\b/gi, checkInside: true },
  { re: /\bnever (?:wrong|makes? (?:a )?mistakes?|gets? (?:it|anything|a \w+) wrong|misses|misreads?|fails)\b/gi, checkInside: false },
];
const NEGATION =
  /\b(not|never|no|nothing|no one|nobody|cannot|can't|won't|don't|doesn't|isn't|aren't|wasn't|without|nor|neither|impossible|rather than|instead of)\b|n't\b/i;

export function findPromise(text: string): string | null {
  for (const { re, checkInside } of PROMISES) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const lineStart = text.lastIndexOf('\n', at - 1) + 1;
      const before = text.slice(Math.max(lineStart, at - 50), at);
      if (NEGATION.test(before)) continue;
      if (checkInside && NEGATION.test(m[0])) continue;
      return m[0];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Links and contacts                                                  */
/* ------------------------------------------------------------------ */

export type Official = { supportEmail: string };

/** The href to keep for a markdown link, or null to drop the target. */
export function allowedHref(href: string, o: Official): string | null {
  const h = href.trim().replace(/^<|>$/g, '');
  if (/^mailto:/i.test(h)) {
    return (h.slice(7).split('?')[0] ?? '').toLowerCase() === o.supportEmail.toLowerCase() ? `mailto:${o.supportEmail}` : null;
  }
  if (h.startsWith('#')) return null;
  if (h.startsWith('/') || SITE_HOSTS.test(h)) return allowedSiteHref(h);
  return null;
}

const LINK = /\[([^\]\n]{1,200})\]\(\s*([^)\s]{1,500})(?:\s+"[^"\n]*")?\s*\)/g;
const IMAGE = /!\[[^\]\n]*\]\([^)\n]*\)/g;
const TAG = /<\/?[a-zA-Z][^>\n]{0,300}>/g;
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+/gi;
/** This site's host written without a scheme. Not after "@" or a dot: that is the support address or a subdomain. */
const BARE_HOST = /(?<![@\w.-])(?:snap-apps\.gaiada\.com|snapapps\.com\.au)(?:\/[^\s<>()[\]{}"']*)?/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+|\b0)\d[\d\s().-]{7,18}\d/g;
const FENCE = /```[a-zA-Z0-9_-]*\n?/g;
const HEADING = /^#{1,6}[ \t]+(.+)$/gm;
const DIRECTIVE = /\[\[\s*([a-zA-Z]+)\s*:?([^\]]*)\]\]/g;
const OPEN_DIRECTIVE = /\[\[\s*([a-zA-Z]+)\s*:?([^\]]*)$/;

/* ------------------------------------------------------------------ */
/* The filter                                                          */
/* ------------------------------------------------------------------ */

/**
 * Where the safe part of `s` ends: everything after this index may still
 * change meaning when more text arrives.
 */
export function safeCut(s: string): number {
  let cut = s.length;
  // The word being written.
  const ws = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'), s.lastIndexOf('\t'));
  if (ws < s.length - 1) cut = ws + 1;
  // A trailing run of digits and number punctuation (an amount arriving in pieces).
  const run = /[0-9+$()\s.,–—/-]*$/.exec(s);
  if (run && /\d|\+$|\$$/.test(run[0])) {
    const lead = /^\s*/.exec(run[0])?.[0].length ?? 0;
    cut = Math.min(cut, run.index + lead);
  }
  // Structures that must leave in one piece, until nothing moves the cut: a
  // cut inside "[[cta: app]]" or "[Pricing](/pricing)" moves back to its
  // opening bracket.
  for (let guard = 0; guard < 8; guard++) {
    const p = s.slice(0, cut);
    let c = cut;
    const d = p.lastIndexOf('[[');
    if (d >= 0 && p.indexOf(']]', d) < 0) c = Math.min(c, d);
    if (p.endsWith('[')) c = Math.min(c, p.length - 1);
    const l = p.lastIndexOf('[');
    if (l >= 0 && l < c && p[l - 1] !== '[') {
      const tail = p.slice(l);
      const complete = /^\[[^\]\n]*\]\([^)\n]*\)/.test(tail);
      const broken =
        /^\[[^\]\n]*\n/.test(tail) || /^\[[^\]\n]*\][^(]/.test(tail) || /^\[[^\]\n]*\]\([^)\n]*\n/.test(tail);
      if (!complete && !broken && s.length - l <= MAX_HOLD) c = Math.min(c, l);
    }
    // A heading line is held until its newline.
    const lineStart = p.lastIndexOf('\n') + 1;
    if (/^#{1,6}(?:[ \t]|$)/.test(p.slice(lineStart)) && lineStart < p.length) c = Math.min(c, lineStart);
    // Line breaks wait for the text that follows them, so the blank lines
    // before the closing [[directives]] are never sent.
    const nl = /\s*\n\s*$/.exec(p);
    if (nl) c = Math.min(c, nl.index);
    if (c === cut) break;
    cut = c;
  }
  return Math.max(0, cut);
}

type Acc = { next: string[]; cta?: Cta; flags: Set<string> };

function readDirective(name: string, body: string, acc: Acc): void {
  const n = name.toLowerCase();
  if (n === 'next' || n === 'suggest' || n === 'suggestions') {
    for (const raw of body.split('|')) {
      const chip = raw
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`#[\]<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (chip.length < 2 || chip.length > 60) continue;
      if (/https?:|www\.|@|\d{6,}/i.test(chip)) continue;
      // A chip is a question the visitor may send; it must not carry a figure the guard never saw.
      if (findAmounts(chip).length) continue;
      const cased = chip.charAt(0).toUpperCase() + chip.slice(1);
      if (!acc.next.some((c) => c.toLowerCase() === cased.toLowerCase())) acc.next.push(cased);
    }
  } else if (n === 'cta') {
    const v = body.trim().toLowerCase();
    if (v === 'app' || v === 'download') acc.cta = 'app';
    else if (v === 'start' || v === 'signup' || v === 'register') acc.cta = 'start';
    else if (v === 'human' || v === 'support') acc.cta = 'human';
  }
}

export function sanitize(seg: string, o: Official, acc: Acc): string {
  let t = seg;
  t = t.replace(DIRECTIVE, (_m, name: string, body: string) => {
    readDirective(name, body, acc);
    return '';
  });
  t = t.replace(FENCE, () => {
    acc.flags.add('markup');
    return '';
  });
  t = t.replace(IMAGE, () => {
    acc.flags.add('markup');
    return '';
  });
  t = t.replace(TAG, () => {
    acc.flags.add('markup');
    return '';
  });
  t = t.replace(HEADING, (_m, h: string) => `**${h.replace(/\*\*/g, '').trim()}**`);
  const links: string[] = [];
  t = t.replace(LINK, (_m, text: string, href: string) => {
    const ok = allowedHref(href, o);
    const label = text.replace(/[[\]]/g, '');
    if (!ok) {
      acc.flags.add('link-dropped');
      return label;
    }
    links.push(`[${label}](${ok})`);
    return `\u0000${links.length - 1}\u0000`;
  });
  t = t.replace(BARE_URL, (u) => {
    if (SITE_HOSTS.test(u)) {
      const p = allowedSiteHref(u);
      if (p) return p === '/' ? (u.replace(/^https?:\/\/(?:www\.)?/i, '').split('/')[0] ?? '') : p;
    }
    acc.flags.add('url-dropped');
    return '';
  });
  // Our own domain written bare stays readable; a path on it that is not a real page loses the path.
  t = t.replace(BARE_HOST, (u) => {
    if (allowedSiteHref(u)) return u;
    acc.flags.add('url-dropped');
    return u.replace(/\/.*$/, '');
  });
  t = t.replace(EMAIL, (e) => {
    if (e.toLowerCase() === o.supportEmail.toLowerCase()) return e;
    acc.flags.add('email-replaced');
    return o.supportEmail;
  });
  t = t.replace(PHONE, (p) => {
    const d = p.replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) return p;
    acc.flags.add('phone-replaced');
    return o.supportEmail;
  });
  // eslint-disable-next-line no-control-regex
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '');
  return t;
}

export type Source = { title: string; url: string };

export type FilterOptions = {
  facts: Facts | null;
  intent: string;
  official: Official;
  /** Micro-dollar keys the answer may state. */
  allowedMoney: Set<string>;
  /** Micro-unit keys of the percentages the answer may state. */
  allowedPercents: Set<string>;
  looking?: Source | undefined;
  pagePath?: string | undefined;
};

export type FilterEnd = {
  tail: string;
  replace?: string;
  actions: Actions;
  sources: Source[];
  flags: string[];
};

export type OutputFilter = {
  push(delta: string): { text: string; stop?: boolean };
  end(): FilterEnd;
};

export function createOutputFilter(opts: FilterOptions): OutputFilter {
  const { official, allowedMoney, allowedPercents } = opts;
  let buf = '';
  let emitted = '';
  /** Line breaks that went through but wait for text after them. */
  let pendingWs = '';
  let violation: null | 'price' | 'guarantee' | 'runaway' = null;
  const acc: Acc = { next: [], flags: new Set() };

  /** Check the whole text so far; record the first violation. */
  const check = (text: string): void => {
    if (findAmounts(text).some((a) => !allowedMoney.has(keyOf(a.micro)))) {
      violation = 'price';
      acc.flags.add('price');
      return;
    }
    if (findPromise(text)) {
      violation = 'guarantee';
      acc.flags.add('guarantee');
      return;
    }
    if (findPercents(text).some((p) => !allowedPercents.has(keyOf(p)))) {
      violation = 'price';
      acc.flags.add('percent');
    }
  };

  return {
    push(delta) {
      if (violation) return { text: '', stop: true };
      buf += delta;
      const cut = safeCut(buf);
      if (cut === 0) return { text: '' };
      let seg = pendingWs + sanitize(buf.slice(0, cut), official, acc);
      buf = buf.slice(cut);
      const trailing = /\s*$/.exec(seg)?.[0] ?? '';
      if (trailing.includes('\n')) {
        pendingWs = trailing;
        seg = seg.slice(0, seg.length - trailing.length);
      } else {
        pendingWs = '';
      }
      check(emitted + seg);
      if (violation) return { text: '', stop: true };
      emitted += seg;
      if (emitted.length > MAX_CHARS) {
        violation = 'runaway';
        acc.flags.add('runaway');
        return { text: seg, stop: true };
      }
      return { text: seg };
    },

    end() {
      let tail = '';
      if (!violation && buf) {
        let rest = buf;
        const open = OPEN_DIRECTIVE.exec(rest);
        if (open) {
          readDirective(open[1] ?? '', open[2] ?? '', acc);
          rest = rest.slice(0, open.index);
        }
        tail = pendingWs + sanitize(rest, official, acc);
        check(emitted + tail);
        if (violation) tail = '';
      }
      buf = '';
      pendingWs = '';
      // Trailing whitespace and a dangling separator left by a removed directive.
      const whole = (emitted + tail).replace(/\s+$/, '');
      tail = whole.slice(emitted.length);

      let replace: string | undefined;
      let actions: Actions = { chips: acc.next.slice(0, 3) };
      const cta = acc.cta ?? defaultCta(opts.intent);
      if (cta) actions.cta = cta;

      if (violation === 'price' || violation === 'guarantee') {
        const s = safeAnswer(violation, opts.facts);
        replace = s.text;
        actions = s.actions;
      } else if (!whole.replace(/[\s*_]/g, '')) {
        const s = safeAnswer('empty', opts.facts);
        replace = s.text;
        actions = s.actions;
        acc.flags.add('empty');
      }

      const finalText = replace ?? whole;
      const out: FilterEnd = {
        tail: replace ? '' : tail,
        actions,
        sources: sourcesOf(finalText, opts.looking, opts.pagePath),
        flags: [...acc.flags],
      };
      if (replace !== undefined) out.replace = replace;
      return out;
    },
  };
}

/**
 * The pages an answer stands on: the ones it links to, then the page the
 * retrieval found, never the page the visitor is already on. At most three.
 */
function sourcesOf(text: string, looking: Source | undefined, pagePath: string | undefined): Source[] {
  const out: Source[] = [];
  const push = (url: string, title?: string): void => {
    const p = sitePath(url)?.path;
    if (!p || p === pagePath || !ALLOWED_PATHS.has(p) || out.some((s) => s.url === p)) return;
    out.push({ title: title ?? SITE_PAGES[p] ?? p, url: p });
  };
  for (const m of text.matchAll(/\]\((\/[^)\s]*)\)/g)) push(m[1] ?? '');
  if (looking) push(looking.url, looking.title);
  return out.slice(0, 3);
}
