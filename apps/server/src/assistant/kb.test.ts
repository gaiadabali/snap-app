import { describe, expect, it } from 'vitest';

import { factsFromPacks } from './facts.js';
import { buildKb, parseFrontMatter, readKnowledgeFiles, type KbTokens } from './kb.js';
import { mentionsMoney } from './money.js';
import { ALLOWED_PATHS } from './site.js';
import { PACK_ROWS } from './test-support.js';

const FIXTURES = new URL('./test-fixtures/knowledge/', import.meta.url);
const facts = factsFromPacks(PACK_ROWS);
const TOKENS: KbTokens = {
  FREE_SCANS: String(facts.freeScans),
  PRICE_PER_SCAN: facts.perScanText,
  PACK_SIZES: facts.packSizesText,
};

describe('knowledge loader', () => {
  const files = readKnowledgeFiles(FIXTURES);
  const kb = buildKb(files, TOKENS);

  it('reads the markdown files, front-matter and all', () => {
    expect(files.map((f) => f.name)).toEqual(['download.md', 'pricing.md', 'retention.md']);
    const { meta } = parseFrontMatter(files[1]?.content ?? '');
    expect(meta).toEqual({ title: 'Pricing and credits', url: '/pricing', kind: 'pricing' });
    expect(kb.problems).toEqual([]);
    expect(kb.pages.map((p) => p.url).sort()).toEqual(['/docs/data-retention', '/download', '/pricing']);
  });

  it('chunks at ##, with each ### FAQ entry on its own', () => {
    const pricing = kb.chunks.filter((c) => c.url === '/pricing').map((c) => c.heading);
    expect(pricing).toEqual(['Pricing and credits', 'How credits work', 'Do credits expire?', 'Is GST included?']);
    const faq = kb.chunks.find((c) => c.heading === 'Do credits expire?');
    expect(faq?.text).toBe('No. Credits stay on the account until they are used.');
  });

  it('drops every block that states money, BEFORE resolving tokens, and drops editor markers', () => {
    const all = kb.chunks.map((c) => c.text).join('\n');
    expect(all).not.toContain('9.99');
    expect(all).not.toContain('$37');
    expect(all).not.toContain('CONFIRM');
    expect(kb.dropped.money).toBe(2);
    expect(kb.dropped.marker).toBe(1);
    // the list item next to the dropped one survives
    expect(all).toContain('Credits never expire.');
  });

  it('resolves the tokens from FACTS', () => {
    const how = kb.chunks.find((c) => c.heading === 'How credits work')?.text ?? '';
    expect(how).toContain('starts with 10 free scans');
    expect(how).toContain('each scan is 3.7 cents');
    expect(how).toContain('packs of 50, 100, 200, 500 and 1,000 scans');
    expect(how).not.toContain('{{');
  });

  it('treats a missing directory as an empty pack, and an empty pack as a failure', () => {
    expect(readKnowledgeFiles(new URL('./no-such-dir/', import.meta.url))).toEqual([]);
    expect(buildKb([], TOKENS).problems).toEqual(['the knowledge pack is empty']);
  });

  it('fails loudly when a placeholder survives', () => {
    const noPrice = buildKb(files, { ...TOKENS, PRICE_PER_SCAN: '' });
    expect(noPrice.problems.some((p) => p.includes('{{PRICE_PER_SCAN}}'))).toBe(true);

    const unknown = buildKb([{ name: 'x.md', content: '---\ntitle: X\nurl: /features\n---\n## A\nSee {{NEW_THING}} here.' }], TOKENS);
    expect(unknown.problems.some((p) => p.includes('{{NEW_THING}}'))).toBe(true);

    const heading = buildKb([{ name: 'y.md', content: '---\ntitle: Y\nurl: /features\n---\n## TODO pick a heading\nText.' }], TOKENS);
    expect(heading.problems.some((p) => p.includes('placeholder in heading'))).toBe(true);

    const noMeta = buildKb([{ name: 'z.md', content: '## Just text\nNo front-matter here.' }], TOKENS);
    expect(noMeta.problems.some((p) => p.includes('front-matter'))).toBe(true);
  });

  it('keeps every chunk at 220 words or fewer', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} talks about receipts and dockets in some detail here.`).join(' ');
    const k = buildKb([{ name: 'l.md', content: `---\ntitle: Long\nurl: /features\n---\n## Long\n${long}\n\n${long}` }], TOKENS);
    expect(k.chunks.length).toBeGreaterThan(1);
    for (const c of k.chunks) expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(220);
  });

  it('warns, without failing, on a url that is not a linkable path', () => {
    const k = buildKb([{ name: 'w.md', content: '---\ntitle: W\nurl: /blog/x\n---\n## W\nSome text.' }], TOKENS);
    expect(k.problems).toEqual([]);
    expect(k.warnings).toHaveLength(1);
  });
});

/**
 * The pack that ships. Written by hand, alongside this loader; this is the
 * gate that keeps a dollar figure or an editor's placeholder out of what the
 * model is told. Skipped only when the directory is empty.
 */
describe('the shipped knowledge pack', () => {
  const files = readKnowledgeFiles();
  const kb = buildKb(files, TOKENS);

  it.skipIf(files.length === 0)('loads with no problems, at linkable paths only', () => {
    expect(kb.problems).toEqual([]);
    expect(kb.warnings).toEqual([]);
    for (const p of kb.pages) expect(ALLOWED_PATHS.has(p.url), p.url).toBe(true);
  });

  it.skipIf(files.length === 0)('states no money except through the resolved tokens', () => {
    const allowed = new Set(['3.7 cents']);
    for (const c of kb.chunks) {
      const stripped = [...allowed].reduce((t, a) => t.split(a).join(''), c.text);
      expect(mentionsMoney(stripped), `${c.id}: ${c.text.slice(0, 80)}`).toBe(false);
    }
  });
});
