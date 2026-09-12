import { describe, expect, it } from 'vitest';

import { unionBox, type Box, type Document, type Line, type Page, type Span } from './docdom.js';
import { read } from './pipeline.js';
import {
  chain,
  violatesLicenceFloor,
  type Capability,
  type Engine,
  type EngineSpec,
  type PageInput,
  type Profile,
} from './registry.js';
import { pdfTextEngineSpec } from './engines/pdf-text.js';
import { SidecarEngine } from './engines/sidecar.js';

/**
 * A FAKE engine, not a live sidecar (docs/contracts/phase1-ocr-stage.md
 * §5.4): every behaviour under test is driven entirely by handlers defined
 * in this file, so these tests exercise `pipeline.ts`'s merge/escalation
 * logic in isolation from PaddleOCR, a Python process, or the network.
 */
function fakeEngine(
  spec: EngineSpec,
  handler: (input: PageInput) => Partial<Document> | Promise<Partial<Document>>,
): Engine & { calls: PageInput[] } {
  const calls: PageInput[] = [];
  return {
    spec,
    calls,
    async read(input: PageInput) {
      calls.push(input);
      return handler(input);
    },
  };
}

function fakeSpec(overrides: Partial<EngineSpec> = {}): EngineSpec {
  return {
    id: 'fake',
    capabilities: ['detect', 'recognise'],
    residency: 'in-process',
    requiresNetwork: false,
    weightsLicence: 'none',
    redistributable: true,
    tier: 0,
    medianSeconds: null,
    note: 'test double',
    ...overrides,
  };
}

function fakePage(overrides: Partial<Page> = {}): Page {
  return {
    number: 1,
    width: 100,
    height: 100,
    dpi: 72,
    source: 'pdf-native',
    restoration: [],
    ...overrides,
  };
}

function fakeInput(overrides: Partial<PageInput> = {}): PageInput {
  return { page: fakePage(), bytes: new Uint8Array(), mimeType: 'application/pdf', ...overrides };
}

function fakeSpan(id: string, text: string, box: Box, confidence = 1, engine = 'fake'): Span {
  return { id, text, box, provenance: { engine, confidence, calibrated: true } };
}

function fakeLine(id: string, spans: Span[]): Line {
  return { id, box: unionBox(spans.map((s) => s.box))!, spans, order: 0 };
}

function fakeBlockDoc(spans: Span[], engine = 'fake'): Partial<Document> {
  const line = fakeLine('l0', spans);
  return {
    blocks: [
      {
        id: 'b0',
        kind: 'unknown',
        box: line.box,
        page: 1,
        order: 0,
        lines: [line],
        provenance: { engine, confidence: 1, calibrated: true },
      },
    ],
  };
}

const PROFILE: Profile = 'cloud-au';

describe('pipeline.read — merge behaviour', () => {
  it('carries a single capable engine\'s reading straight into the Document', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const engine = fakeEngine(fakeSpec({ id: 'a', tier: 0 }), () =>
      fakeBlockDoc([fakeSpan('s0', 'hello', box)], 'a'),
    );

    const doc = await read([fakeInput()], [engine], PROFILE);

    expect(doc.pages).toHaveLength(1);
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.lines[0]!.spans[0]!.text).toBe('hello');
    expect(doc.unreadable).toHaveLength(0);
    expect(engine.calls).toHaveLength(1);
  });

  it('merges tables, figures and fields from the chosen engine', async () => {
    const table: Document['tables'][number] = {
      id: 't0',
      page: 1,
      box: { x: 0, y: 0, width: 5, height: 5 },
      rows: 1,
      cols: 1,
      cells: [],
      provenance: { engine: 'a', confidence: 1, calibrated: true },
    };
    const engine = fakeEngine(fakeSpec({ id: 'a' }), () => ({ tables: [table] }));

    const doc = await read([fakeInput()], [engine], PROFILE);

    expect(doc.tables).toEqual([table]);
  });
});

describe('pipeline.read — tier escalation on failure', () => {
  it('escalates to the next tier when the cheapest engine throws', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const cheap = fakeEngine(fakeSpec({ id: 'cheap', tier: 0 }), () => {
      throw new Error('boom');
    });
    const expensive = fakeEngine(fakeSpec({ id: 'expensive', tier: 1 }), () =>
      fakeBlockDoc([fakeSpan('s0', 'rescued', box)], 'expensive'),
    );

    const doc = await read([fakeInput()], [cheap, expensive], PROFILE);

    expect(cheap.calls).toHaveLength(1);
    expect(expensive.calls).toHaveLength(1);
    expect(doc.blocks[0]!.lines[0]!.spans[0]!.text).toBe('rescued');
  });

  it('escalates when the cheapest engine abstains (returns nothing) rather than throwing', async () => {
    // This is pdf-text on a scanned page in miniature: no error, just no
    // embedded text to report.
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const cheap = fakeEngine(fakeSpec({ id: 'cheap', tier: 0 }), () => ({}));
    const expensive = fakeEngine(fakeSpec({ id: 'expensive', tier: 1 }), () =>
      fakeBlockDoc([fakeSpan('s0', 'rescued', box)], 'expensive'),
    );

    const doc = await read([fakeInput()], [cheap, expensive], PROFILE);

    expect(cheap.calls).toHaveLength(1);
    expect(expensive.calls).toHaveLength(1);
    expect(doc.blocks).toHaveLength(1);
  });

  it('marks a page unreadable, with the last failure reason, when every engine in the chain fails', async () => {
    const a = fakeEngine(fakeSpec({ id: 'a', tier: 0 }), () => {
      throw new Error('a is down');
    });
    const b = fakeEngine(fakeSpec({ id: 'b', tier: 1 }), () => {
      throw new Error('b is down too');
    });

    const doc = await read([fakeInput({ page: fakePage({ number: 7 }) })], [a, b], PROFILE);

    expect(doc.blocks).toHaveLength(0);
    expect(doc.unreadable).toHaveLength(1);
    expect(doc.unreadable[0]!.page).toBe(7);
    expect(doc.unreadable[0]!.reason).toContain('b is down too');
  });

  it('fills a gap the primary engine left in `unreadable` by escalating just that region', async () => {
    const readBox: Box = { x: 0, y: 0, width: 10, height: 10 };
    const gapBox: Box = { x: 20, y: 20, width: 10, height: 10 };
    const primary = fakeEngine(fakeSpec({ id: 'primary', tier: 0 }), () => ({
      ...fakeBlockDoc([fakeSpan('s0', 'known', readBox)], 'primary'),
      unreadable: [{ page: 1, box: gapBox, reason: 'glare' }],
    }));
    const secondary = fakeEngine(fakeSpec({ id: 'secondary', tier: 1 }), (input) => {
      expect(input.region).toEqual(gapBox);
      return fakeBlockDoc([fakeSpan('s1', 'filled', gapBox)], 'secondary');
    });

    const doc = await read([fakeInput()], [primary, secondary], PROFILE);

    expect(doc.unreadable).toHaveLength(0);
    const texts = doc.blocks.flatMap((b) => b.lines.flatMap((l) => l.spans.map((s) => s.text)));
    expect(texts.sort()).toEqual(['filled', 'known']);
    expect(secondary.calls).toHaveLength(1);
  });

  it('keeps a gap in `unreadable` when no later engine can fill it either', async () => {
    const gapBox: Box = { x: 20, y: 20, width: 10, height: 10 };
    const primary = fakeEngine(fakeSpec({ id: 'primary', tier: 0 }), () => ({
      unreadable: [{ page: 1, box: gapBox, reason: 'glare' }],
    }));
    const secondary = fakeEngine(fakeSpec({ id: 'secondary', tier: 1 }), () => ({}));

    const doc = await read([fakeInput()], [primary, secondary], PROFILE);

    expect(doc.unreadable).toEqual([{ page: 1, box: gapBox, reason: 'glare' }]);
  });
});

describe('pipeline.read — disagreement', () => {
  it('records a low-confidence span\'s disagreement with the next engine, rather than picking a winner silently', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const primary = fakeEngine(fakeSpec({ id: 'primary', tier: 0 }), () =>
      fakeBlockDoc([fakeSpan('s0', 'total: $17S19.31', box, 0.4)], 'primary'),
    );
    const secondary = fakeEngine(fakeSpec({ id: 'secondary', tier: 1 }), (input) => {
      expect(input.region).toEqual(box);
      return fakeBlockDoc([fakeSpan('s1', 'total: $17519.31', box, 0.97)], 'secondary');
    });

    const doc = await read([fakeInput()], [primary, secondary], PROFILE);

    const span = doc.blocks[0]!.lines[0]!.spans[0]!;
    // The cheaper engine's reading stays canonical...
    expect(span.text).toBe('total: $17S19.31');
    // ...but the disagreement is preserved, not discarded.
    expect(span.provenance.disputedBy).toEqual([
      { engine: 'secondary', text: 'total: $17519.31', confidence: 0.97 },
    ]);
  });

  it('does not record a dispute when the confirming engine agrees (modulo whitespace/case)', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const primary = fakeEngine(fakeSpec({ id: 'primary', tier: 0 }), () =>
      fakeBlockDoc([fakeSpan('s0', ' Total ', box, 0.5)], 'primary'),
    );
    const secondary = fakeEngine(fakeSpec({ id: 'secondary', tier: 1 }), () =>
      fakeBlockDoc([fakeSpan('s1', 'total', box, 0.9)], 'secondary'),
    );

    const doc = await read([fakeInput()], [primary, secondary], PROFILE);

    expect(doc.blocks[0]!.lines[0]!.spans[0]!.provenance.disputedBy).toBeUndefined();
  });

  it('does not confirm spans that already meet the confidence threshold', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const primary = fakeEngine(fakeSpec({ id: 'primary', tier: 0 }), () =>
      fakeBlockDoc([fakeSpan('s0', 'confident', box, 0.99)], 'primary'),
    );
    const secondary = fakeEngine(fakeSpec({ id: 'secondary', tier: 1 }), () =>
      fakeBlockDoc([fakeSpan('s1', 'irrelevant', box, 0.99)], 'secondary'),
    );

    await read([fakeInput()], [primary, secondary], PROFILE);

    expect(secondary.calls).toHaveLength(0);
  });
});

describe('pipeline.read — profile filtering', () => {
  it('never invokes an external-api engine under the air-gapped profile', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const frontier = fakeEngine(
      fakeSpec({ id: 'frontier', tier: 3, residency: 'external-api', requiresNetwork: true }),
      () => fakeBlockDoc([fakeSpan('s0', 'should never run', box)], 'frontier'),
    );

    const doc = await read([fakeInput()], [frontier], 'air-gapped');

    expect(frontier.calls).toHaveLength(0);
    expect(doc.blocks).toHaveLength(0);
    expect(doc.unreadable).toHaveLength(1);
    expect(doc.unreadable[0]!.reason).toContain('air-gapped');
  });

  it('permits the same engine under cloud-au', async () => {
    const box: Box = { x: 0, y: 0, width: 10, height: 10 };
    const frontier = fakeEngine(
      fakeSpec({ id: 'frontier', tier: 3, residency: 'external-api', requiresNetwork: true }),
      () => fakeBlockDoc([fakeSpan('s0', 'ran fine', box)], 'frontier'),
    );

    const doc = await read([fakeInput()], [frontier], 'cloud-au');

    expect(frontier.calls).toHaveLength(1);
    expect(doc.blocks).toHaveLength(1);
  });

  it('matches registry.chain\'s own ordering — this is not reimplemented routing logic', () => {
    const specs = [
      fakeSpec({ id: 'slow', tier: 2 }),
      fakeSpec({ id: 'fast', tier: 0 }),
      fakeSpec({ id: 'mid', tier: 1 }),
      fakeSpec({ id: 'offshore', tier: 0, residency: 'external-api', requiresNetwork: true }),
    ];
    const capability: Capability = 'recognise';
    const airGapped = chain(specs, capability, 'air-gapped').map((s) => s.id);
    expect(airGapped).toEqual(['fast', 'mid', 'slow']);
  });
});

describe('licence floor — the two real engines this lane registers', () => {
  it('pdf-text (no weights) never violates the floor', () => {
    expect(violatesLicenceFloor([pdfTextEngineSpec])).toEqual([]);
  });

  it('the sidecar (Apache-2.0, redistributable) does not violate the floor', () => {
    const spec = new SidecarEngine().spec;
    expect(spec.weightsLicence).toBe('apache-2.0');
    expect(spec.redistributable).toBe(true);
    expect(violatesLicenceFloor([spec])).toEqual([]);
  });

  it('a proprietary, non-redistributable engine DOES violate the floor — sanity check on the fixture, not just the real specs', () => {
    const bad = fakeSpec({ id: 'bad', weightsLicence: 'proprietary', redistributable: false });
    expect(violatesLicenceFloor([bad])).toEqual([bad]);
  });
});
