import { describe, expect, it } from 'vitest';

import { createRetriever, expandQuery, stemEn, tokenize, type KbChunk } from './retrieve.js';

const chunk = (id: string, url: string, heading: string, text: string, title = heading): KbChunk => ({
  id,
  url,
  title,
  heading,
  text,
  kind: 'page',
});

const CHUNKS: KbChunk[] = [
  chunk('p#0', '/pricing', 'How credits work', 'Every new account starts with free scans. After that each scan costs one credit.', 'Pricing and credits'),
  chunk('p#1', '/pricing', 'Do credits expire?', 'No. Credits stay on the account until they are used.', 'Pricing and credits'),
  chunk('p#2', '/pricing', 'Packs', 'Credits come in packs. Every pack has the same rate per scan.', 'Pricing and credits'),
  chunk('d#0', '/download', 'Android', 'Download the Android app as an APK from the download page.', 'Download and install'),
  chunk('d#1', '/download', 'iPhone', 'The iPhone app is in development. Use the web app in Safari until it ships.', 'Download and install'),
  chunk('r#0', '/docs/data-retention', 'Five-year retention', 'Snap Apps keeps the original photo of every receipt as a true copy for five years.', 'Records'),
  chunk('g#0', '/features', 'GST split', 'Snap Apps reads every line of a docket and splits GST-free items from taxable ones.', 'Reading every line'),
];

describe('BM25 retrieval', () => {
  const r = createRetriever(CHUNKS);

  it('stems and drops stopwords', () => {
    expect(stemEn('receipts')).toBe('receipt');
    expect(stemEn('scanning')).toBe('scan');
    expect(tokenize('How do I keep my receipts?')).toEqual(['keep', 'receipt']);
  });

  it('finds the right section for plain questions', () => {
    expect(r.search('do my credits expire')[0]?.chunk.id).toBe('p#1');
    expect(r.search('is there an iPhone version')[0]?.chunk.id).toBe('d#1');
    expect(r.search('how is GST split on a receipt')[0]?.chunk.id).toBe('g#0');
  });

  it('uses synonyms: ios → iPhone, docket → receipt, how much → pricing', () => {
    expect(r.search('is it on ios')[0]?.chunk.url).toBe('/download');
    expect(r.search('how long do you keep dockets')[0]?.chunk.url).toBe('/docs/data-retention');
    expect(r.search('how much is it')[0]?.chunk.url).toBe('/pricing');
    expect([...expandQuery('docket').keys()]).toContain('receipt');
  });

  it('returns at most two hits per URL and at most k', () => {
    const hits = r.search('credits pack scan price cost', { k: 6 });
    expect(hits.filter((h) => h.chunk.url === '/pricing').length).toBeLessThanOrEqual(2);
    expect(r.search('snap apps receipt scan credit app', { k: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('boosts the page the visitor is on', () => {
    const plain = r.search('app');
    const boosted = r.search('app', { boostUrl: '/download' });
    const score = (hs: typeof plain) => hs.find((h) => h.chunk.url === '/download')?.score ?? 0;
    expect(score(boosted)).toBeCloseTo(score(plain) * 1.35, 5);
  });

  it('returns nothing for an empty pack or an empty query', () => {
    expect(createRetriever([]).search('anything')).toEqual([]);
    expect(r.search('the and of')).toEqual([]);
  });
});
