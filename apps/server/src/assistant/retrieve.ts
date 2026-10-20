/**
 * BM25 retriever over the knowledge pack (docs/ASSISTANT.md §6), ported from
 * Tunas, English only.
 *
 * k1 1.2, b 0.75; fields weighted heading 2.2, title 1.6, text 1; an English
 * stemmer and stopwords; a synonym table (expansions at 0.6); the visitor's
 * current page ×1.35; at most 2 hits per URL.
 */

export type KbChunk = {
  id: string;
  url: string;
  title: string;
  heading: string;
  text: string;
  kind: string;
};

export type Hit = { chunk: KbChunk; score: number };
export type SearchOpts = { k?: number; boostUrl?: string | undefined; minScore?: number };
export type Retriever = { search(query: string, opts?: SearchOpts): Hit[] };

const K1 = 1.2;
const B = 0.75;
const W_HEADING = 2.2;
const W_TITLE = 1.6;
const W_TEXT = 1;
const BOOST = 1.35;
const EXPANDED_WEIGHT = 0.6;
const MAX_PER_URL = 2;

const STOP = new Set(
  (
    'a an the and or but if of to in on at by for with from as is are was were be been being am do does did doing done have has had having ' +
    'i me my we our us you your yours he she it its they them their this that these those there here what which who whom whose when where why how ' +
    "can could will would shall should may might must not no yes so than then too very just also about into over out up down off any some such " +
    'much many more most other each both few all one s t im ive dont get got'
  ).split(/\s+/),
);

/**
 * Synonym groups. `t` are the phrases that trigger the group, `x` everything
 * added to the query (at weight 0.6).
 */
const SYNONYMS: Array<{ t: string[]; x: string[] }> = [
  { t: ['receipt', 'docket', 'dockets', 'receipts', 'invoice', 'bill'], x: ['receipt', 'docket', 'invoice', 'bill'] },
  { t: ['gst', 'goods and services tax', 'tax'], x: ['gst', 'tax', 'goods and services tax'] },
  { t: ['price', 'cost', 'pricing', 'credits', 'credit', 'how much', 'fee', 'pack', 'packs', 'pay'], x: ['price', 'pricing', 'cost', 'credit', 'pack', 'scan'] },
  { t: ['iphone', 'ios', 'apple', 'app store', 'ipad'], x: ['iphone', 'ios', 'apple'] },
  { t: ['android', 'apk', 'google play', 'play store', 'samsung', 'pixel'], x: ['android', 'apk', 'download'] },
  { t: ['download', 'install', 'get the app'], x: ['download', 'install', 'android', 'apk'] },
  { t: ['photo', 'picture', 'snap', 'capture', 'camera', 'scan'], x: ['photo', 'capture', 'camera', 'scan'] },
  { t: ['read', 'reading', 'extract', 'ocr', 'line items', 'lines'], x: ['read', 'line', 'item', 'extract'] },
  { t: ['abn', 'business number'], x: ['abn', 'australian business number'] },
  { t: ['tax invoice', 'valid invoice', 'valid receipt'], x: ['tax invoice', 'valid', 'abn', 'requirements'] },
  { t: ['keep', 'retention', 'how long', 'store', 'storage', 'five years', '5 years'], x: ['retention', 'keep', 'five years', 'records', 'true copy'] },
  { t: ['privacy', 'private', 'data', 'personal information', 'delete'], x: ['privacy', 'data', 'personal information'] },
  { t: ['secure', 'security', 'safe', 'encrypt', 'encryption', 'hack'], x: ['security', 'secure', 'encryption'] },
  { t: ['wrong', 'mistake', 'fix', 'correct', 'correction', 'edit', 'misread'], x: ['correction', 'fix', 'review', 'edit'] },
  { t: ['confidence', 'flag', 'flagged', 'unsure', 'check'], x: ['confidence', 'flag', 'review'] },
  { t: ['ledger', 'posted', 'post', 'books'], x: ['ledger', 'posted'] },
  { t: ['export', 'csv', 'accountant', 'bas', 'tax time'], x: ['export', 'accountant', 'records'] },
  { t: ['family', 'household', 'share', 'partner', 'together'], x: ['household', 'share', 'family'] },
  { t: ['support', 'help', 'contact', 'email', 'person', 'human'], x: ['support', 'contact', 'email', 'help'] },
  { t: ['free', 'trial', 'sign up', 'signup', 'register', 'start'], x: ['free', 'sign up', 'register', 'start'] },
  { t: ['snapper', 'assistant', 'chatbot', 'bot'], x: ['snapper', 'assistant'] },
  { t: ['xero', 'myob', 'quickbooks', 'business features', 'mileage', 'bas report', 'tax pack'], x: ['business', 'not in the app today', 'coming'] },
];

function fold(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Raw tokens: folded, split on non-letters/digits. No stopwords, no stemming. */
export function rawTokens(s: string): string[] {
  return fold(s)
    .replace(/[’']/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function stemEn(w: string): string {
  if (w.length <= 3 || /^\d/.test(w)) return w;
  let s = w;
  if (s.endsWith('ies') && s.length > 4) s = `${s.slice(0, -3)}y`;
  else if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (s.endsWith('s') && s.length > 3 && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.endsWith('ing') && s.length > 5) {
    s = s.slice(0, -3);
    if (/([^aeiou])\1$/.test(s) && !/(ll|ss|ff)$/.test(s)) s = s.slice(0, -1);
  } else if (s.endsWith('ed') && s.length > 4) {
    s = s.slice(0, -2);
    if (/([^aeiou])\1$/.test(s) && !/(ll|ss|ff)$/.test(s)) s = s.slice(0, -1);
  } else if (s.endsWith('ly') && s.length > 5) {
    s = s.slice(0, -2);
  }
  if (s.endsWith('ation') && s.length > 7) s = s.slice(0, -5);
  if (s.endsWith('e') && s.length > 4) s = s.slice(0, -1);
  return s.replace(/z/g, 's');
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const t of rawTokens(text)) {
    if (STOP.has(t)) continue;
    out.push(stemEn(t));
  }
  return out;
}

/** Link targets in chunk text ("(/pricing)") are not words. */
const stripPaths = (s: string): string => s.replace(/\(\/[^)\s]*\)/g, ' ');

/** Query terms (raw, folded, no stopwords) with weights; synonym expansions at 0.6. */
export function expandQuery(query: string): Map<string, number> {
  const raw = rawTokens(query);
  const stems = raw.map(stemEn);
  const terms = new Map<string, number>();
  for (const t of raw) if (!STOP.has(t)) terms.set(t, 1);
  const matches = (phrase: string): boolean => {
    const p = rawTokens(phrase);
    const ps = p.map(stemEn);
    outer: for (let i = 0; i + p.length <= raw.length; i++) {
      for (let j = 0; j < p.length; j++) if (raw[i + j] !== p[j] && stems[i + j] !== ps[j]) continue outer;
      return true;
    }
    return false;
  };
  for (const g of SYNONYMS) {
    if (!g.t.some(matches)) continue;
    for (const phrase of g.x) {
      for (const t of rawTokens(phrase)) {
        if (STOP.has(t)) continue;
        if (!terms.has(t)) terms.set(t, EXPANDED_WEIGHT);
      }
    }
  }
  return terms;
}

export function createRetriever(chunks: KbChunk[]): Retriever {
  const postings = new Map<string, Array<[number, number]>>();
  const dl = new Float64Array(chunks.length);
  chunks.forEach((c, i) => {
    const tf = new Map<string, number>();
    let len = 0;
    const fields: Array<[string, number]> = [
      [c.heading, W_HEADING],
      [c.title, W_TITLE],
      [stripPaths(c.text), W_TEXT],
    ];
    for (const [field, weight] of fields) {
      for (const t of tokenize(field)) {
        tf.set(t, (tf.get(t) ?? 0) + weight);
        len += weight;
      }
    }
    dl[i] = len;
    for (const [t, w] of tf) {
      let list = postings.get(t);
      if (!list) {
        list = [];
        postings.set(t, list);
      }
      list.push([i, w]);
    }
  });
  const n = chunks.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += dl[i] ?? 0;
  const avgdl = n ? total / n : 1;
  const idf = new Map<string, number>();
  for (const [t, list] of postings) idf.set(t, Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5)));

  function search(query: string, opts: SearchOpts = {}): Hit[] {
    const { k = 6, boostUrl, minScore = 0 } = opts;
    if (!n) return [];
    const qw = new Map<string, number>();
    for (const [t, w] of expandQuery(String(query ?? ''))) {
      const s = stemEn(t);
      qw.set(s, Math.max(qw.get(s) ?? 0, w));
    }
    const scores = new Map<number, number>();
    for (const [t, w] of qw) {
      const list = postings.get(t);
      if (!list) continue;
      const termIdf = idf.get(t) ?? 0;
      for (const [di, tf] of list) {
        const norm = K1 * (1 - B + (B * (dl[di] ?? 0)) / avgdl);
        scores.set(di, (scores.get(di) ?? 0) + w * termIdf * ((tf * (K1 + 1)) / (tf + norm)));
      }
    }
    const all: Hit[] = [];
    for (const [di, s] of scores) {
      const chunk = chunks[di];
      if (!chunk) continue;
      all.push({ chunk, score: boostUrl && chunk.url === boostUrl ? s * BOOST : s });
    }
    all.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));
    const out: Hit[] = [];
    const perUrl = new Map<string, number>();
    for (const h of all) {
      if (out.length >= k) break;
      if (h.score < minScore) break;
      const c = perUrl.get(h.chunk.url) ?? 0;
      if (c >= MAX_PER_URL) continue;
      perUrl.set(h.chunk.url, c + 1);
      out.push(h);
    }
    return out;
  }

  return { search };
}
