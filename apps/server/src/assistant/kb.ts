import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mentionsMoney } from './money.js';
import type { KbChunk } from './retrieve.js';
import { ALLOWED_PATHS } from './site.js';

/**
 * The knowledge pack (docs/ASSISTANT.md §6): `knowledge/*.md`, read at
 * startup (the server runs from source, so there is no build step), chunked
 * and checked here. Tunas's builder rules, applied at load:
 *
 *  - front-matter `title`, `url` (a real site path), `kind`;
 *  - chunked at `##`; inside a section, each `###` (an FAQ entry) is its own
 *    chunk; no chunk over 220 words;
 *  - NO MONEY: any block (paragraph, list item, table row) that states a
 *    dollar or cent figure is dropped whole, BEFORE tokens are resolved —
 *    prices reach the model only through FACTS, and the tokens below;
 *  - blocks holding an editor's marker (`[CONFIRM`, `TODO`, `TBD`) are
 *    dropped too;
 *  - `{{FREE_SCANS}}`, `{{PRICE_PER_SCAN}}`, `{{PACK_SIZES}}` resolve from
 *    FACTS. A placeholder that survives (an unknown token, or a marker in a
 *    title or heading) makes the pack FAIL: `problems` is non-empty, status
 *    answers ok:false, and the loader logs one line saying why.
 */

export type KbPage = { url: string; title: string; kind: string };
export type KbFile = { name: string; content: string };
export type Kb = {
  pages: KbPage[];
  chunks: KbChunk[];
  problems: string[];
  warnings: string[];
  dropped: { money: number; marker: number; token: number; empty: number };
};

export type KbTokens = Record<'FREE_SCANS' | 'PRICE_PER_SCAN' | 'PACK_SIZES', string>;

export const KNOWLEDGE_DIR = new URL('./knowledge/', import.meta.url);
const CHUNK_MAX_WORDS = 220;
const MARKER_RE = /\[\s*(?:CONFIRM|CLIENT)|\bCONFIRM\s*:|\bTODO\b|\bTBD\b|\bFIXME\b/i;
const TOKEN_RE = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;

/** The markdown files in the knowledge directory, by name. A missing directory is an empty pack. */
export function readKnowledgeFiles(dir: URL | string = KNOWLEDGE_DIR): KbFile[] {
  const path = typeof dir === 'string' ? dir : fileURLToPath(dir);
  let names: string[];
  try {
    names = readdirSync(path).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
  const out: KbFile[] = [];
  for (const name of names) {
    try {
      out.push({ name, content: readFileSync(`${path.replace(/[\\/]+$/, '')}/${name}`, 'utf8') });
    } catch {
      /* unreadable file: reported as missing by the caller's chunk count */
    }
  }
  return out;
}

/** Front-matter (top-level `key: value` scalars only) and the body after it. */
export function parseFrontMatter(content: string): { meta: Record<string, string>; body: string } {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? '').split('\n')) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let v = (kv[2] ?? '').trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) v = v.slice(1, -1);
    meta[(kv[1] ?? '').toLowerCase()] = v;
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Markdown to plain text. Site-relative links keep their path: `text (/path)`. */
export function cleanMarkdown(s: string): string {
  let t = s;
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  t = t.replace(/\[([^\]]*)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g, (_m, text: string, href: string) => {
    const label = text.replace(/\s*[→›»]\s*$/, '').trim();
    if (/^\/(?!\/)/.test(href)) return label ? `${label} (${href})` : href;
    if (/^mailto:/i.test(href)) return label || href.slice(7);
    return label;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  t = t.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, '$1$2');
  t = t.replace(/\*\*|__/g, '');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '- ');
  t = t.replace(/^\s*>\s?/, '');
  t = t.replace(/[ \t]+/g, ' ').trim();
  return t;
}

/** Resolve the tokens; unknown ones are left in place (and caught by the caller). */
export function resolveTokens(s: string, tokens: KbTokens): string {
  return s.replace(TOKEN_RE, (m, name: string) => {
    const v = (tokens as Record<string, string | undefined>)[name];
    return typeof v === 'string' && v !== '' ? v : m;
  });
}

/** Split a section body into blocks: paragraphs, and each list item / table row on its own. */
function blocksOf(body: string): string[] {
  const out: string[] = [];
  for (const para of body.split(/\n\s*\n/)) {
    const lines = para.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    let cur: string[] = [];
    const flush = (): void => {
      if (cur.length) out.push(cur.join(' '));
      cur = [];
    };
    for (const line of lines) {
      const item = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line) || /^\s*\|/.test(line);
      if (item) flush();
      if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // table separator row
      cur.push(line.trim());
      if (/^\s*\|/.test(line)) flush();
    }
    flush();
  }
  return out;
}

type Section = { heading: string; body: string };

/** `##` sections; inside one, each `###` becomes its own section. Text before the first `##` uses the title. */
function sectionsOf(body: string, title: string): Section[] {
  const out: Section[] = [];
  let heading = title;
  let sub: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    const text = buf.join('\n').trim();
    if (text) out.push({ heading: sub ?? heading, body: text });
    buf = [];
  };
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h2 = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    const h3 = inFence ? null : /^###\s+(.+?)\s*#*\s*$/.exec(line);
    const h1 = inFence ? null : /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      flush();
      heading = h2[1] ?? title;
      sub = null;
    } else if (h3) {
      flush();
      sub = h3[1] ?? null;
    } else if (h1) {
      flush();
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Group blocks into chunks of at most CHUNK_MAX_WORDS; an oversized block is split by words. */
function groupBlocks(blocks: string[]): string[] {
  const pieces: string[] = [];
  for (const b of blocks) {
    if (words(b) <= CHUNK_MAX_WORDS) {
      pieces.push(b);
      continue;
    }
    const w = b.split(/\s+/).filter(Boolean);
    for (let i = 0; i < w.length; i += CHUNK_MAX_WORDS) pieces.push(w.slice(i, i + CHUNK_MAX_WORDS).join(' '));
  }
  const groups: string[] = [];
  let cur: string[] = [];
  let n = 0;
  for (const p of pieces) {
    const pw = words(p);
    if (cur.length && n + pw > CHUNK_MAX_WORDS) {
      groups.push(cur.join('\n'));
      cur = [];
      n = 0;
    }
    cur.push(p);
    n += pw;
  }
  if (cur.length) groups.push(cur.join('\n'));
  return groups;
}

/**
 * Build the pack from files, with tokens from FACTS. Pure: the caller decides
 * what to log and whether to serve.
 */
export function buildKb(files: KbFile[], tokens: KbTokens): Kb {
  const kb: Kb = { pages: [], chunks: [], problems: [], warnings: [], dropped: { money: 0, marker: 0, token: 0, empty: 0 } };
  const seenPages = new Set<string>();

  for (const file of files) {
    const { meta, body } = parseFrontMatter(file.content);
    const title = (meta.title ?? '').trim();
    const url = (meta.url ?? '').trim();
    const kind = (meta.kind ?? '').trim() || 'page';
    if (!title || !url) {
      kb.problems.push(`${file.name}: front-matter needs title and url`);
      continue;
    }
    if (MARKER_RE.test(title) || /\{\{/.test(title) || mentionsMoney(title)) {
      kb.problems.push(`${file.name}: placeholder or money in the title`);
      continue;
    }
    if (!ALLOWED_PATHS.has(url)) {
      kb.warnings.push(`${file.name}: url ${url} is not a linkable site path; its chunks are context only`);
    }
    if (!seenPages.has(url)) {
      seenPages.add(url);
      kb.pages.push({ url, title, kind });
    }

    const slug = file.name.replace(/\.md$/, '');
    let n = 0;
    for (const section of sectionsOf(body, title)) {
      if (MARKER_RE.test(section.heading) || /\{\{/.test(section.heading)) {
        kb.problems.push(`${file.name}: placeholder in heading "${section.heading}"`);
        continue;
      }
      const heading = mentionsMoney(section.heading) ? title : section.heading;
      const kept: string[] = [];
      for (const raw of blocksOf(section.body)) {
        if (MARKER_RE.test(raw)) {
          kb.dropped.marker++;
          continue;
        }
        if (mentionsMoney(raw)) {
          kb.dropped.money++;
          continue;
        }
        const resolved = resolveTokens(raw, tokens);
        const left = /\{\{\s*([A-Z0-9_]*)\s*\}\}/.exec(resolved);
        if (left) {
          kb.dropped.token++;
          kb.problems.push(`${file.name}: unresolved placeholder {{${left[1] ?? ''}}}`);
          continue;
        }
        const text = cleanMarkdown(resolved);
        if (!text || !/[\p{L}\p{N}]/u.test(text)) {
          kb.dropped.empty++;
          continue;
        }
        kept.push(text);
      }
      for (const text of groupBlocks(kept)) {
        kb.chunks.push({ id: `${slug}#${n++}`, url, title, heading, text, kind });
      }
    }
  }
  if (kb.chunks.length === 0) kb.problems.push('the knowledge pack is empty');
  return kb;
}
