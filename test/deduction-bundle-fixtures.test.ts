import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROFILES } from '../packages/tax-engine/src/index';
import {
  ATO_LABELS,
  ITEM_IDS,
  OCCUPATION_IDS,
  validateDeductionBundleJson,
} from '../packages/api-contract/src/deduction-bundle';

/**
 * DEDUCTION BUNDLE v1 (group 4.1): the fixtures SnapApp shares byte for byte
 * with Free Tax Returns, and the check that the item catalogue still matches
 * the tax-engine copy.
 *
 * The root suite is where this lives because it may read files and import
 * `@snap/tax-engine`; `packages/api-contract` may do neither. FTR's twin is
 * `src/lib/import/deduction-bundle.test.ts` in the FTR repo.
 */

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'packages/api-contract/fixtures/deduction-bundle-v1');
const read = (name: string) => readFileSync(join(DIR, name));
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Manifest {
  specSha256: string;
  cases: { file: string; valid: boolean; errorPaths: string[]; sha256: string }[];
}

/** Pinned in BOTH repos' tests. Changing a shared fixture means changing this in both. */
const MANIFEST_SHA256 = '3728dd12a7c1fdc817a2f03ee51534489efeaf625350fe1a9c09a1eadd6e38ed';

const manifest = JSON.parse(read('index.json').toString('utf8')) as Manifest;

describe('shared fixtures are the agreed bytes', () => {
  it('pins the manifest', () => {
    expect(sha256(read('index.json'))).toBe(MANIFEST_SHA256);
  });

  it('pins the shared spec file', () => {
    const spec = readFileSync(join(ROOT, 'packages/api-contract/src/deduction-bundle-spec.ts'));
    expect(sha256(spec)).toBe(manifest.specSha256);
  });

  it.each(manifest.cases)('$file matches its manifest hash', ({ file, sha256: expected }) => {
    expect(sha256(read(file))).toBe(expected);
  });
});

describe('the validator against the shared fixtures', () => {
  it('lists valid and invalid cases', () => {
    expect(manifest.cases.filter((c) => c.valid).length).toBeGreaterThanOrEqual(3);
    expect(manifest.cases.filter((c) => !c.valid).length).toBeGreaterThanOrEqual(6);
  });

  it.each(manifest.cases.filter((c) => c.valid))('accepts $file', ({ file }) => {
    expect(validateDeductionBundleJson(read(file).toString('utf8'))).toMatchObject({ ok: true });
  });

  it.each(manifest.cases.filter((c) => !c.valid))('rejects $file at $errorPaths', ({ file, errorPaths }) => {
    const result = validateDeductionBundleJson(read(file).toString('utf8'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.path)).toEqual(errorPaths);
  });

  it('keeps valid fixtures within the profile of their occupation', () => {
    for (const c of manifest.cases.filter((x) => x.valid)) {
      const bundle = JSON.parse(read(c.file).toString('utf8'));
      if (!bundle.occupation) continue;
      const profile = PROFILES[bundle.occupation];
      for (const line of bundle.lines as { label: string; itemId: string }[]) {
        if (!['D1', 'D3', 'D5'].includes(line.label)) continue;
        const ids = new Set(
          (profile.categories.find((cat) => cat.label === line.label)?.itemSets ?? []).flatMap((s) =>
            s.items.map((i) => (line.label === 'D5' ? i.id.replace(/_\d+$/, '') : i.id)),
          ),
        );
        if (line.label === 'D5') ['phoneDevices', 'otTotal'].forEach((x) => ids.add(x));
        expect(ids.has(line.itemId), `${c.file}: ${line.label} ${line.itemId} for ${bundle.occupation}`).toBe(true);
      }
    }
  });
});

describe('catalogue matches the tax-engine copy', () => {
  const union = (label: string, id: (s: string) => string = (s) => s) => {
    const out = new Set<string>();
    for (const p of Object.values(PROFILES)) {
      for (const cat of p.categories.filter((c) => c.label === label)) {
        for (const s of cat.itemSets ?? []) s.items.forEach((i) => out.add(id(i.id)));
      }
    }
    return out;
  };
  const sorted = (xs: Iterable<string>) => [...xs].sort();

  it('occupations are the 19 PROFILES keys', () => {
    expect(OCCUPATION_IDS).toHaveLength(19);
    expect(sorted(OCCUPATION_IDS)).toEqual(sorted(Object.keys(PROFILES)));
  });

  it('labels are the ATO labels the engine computes', () => {
    const engineLabels = new Set(Object.values(PROFILES).flatMap((p) => p.cheatRows));
    expect(sorted(ATO_LABELS)).toEqual(sorted(engineLabels));
  });

  it('D1, D3, D5 and RENTAL ids are the engine item ids', () => {
    expect(sorted(ITEM_IDS.D1)).toEqual(sorted([...union('D1'), 'fuelReceiptTotal']));
    expect(sorted(ITEM_IDS.D3)).toEqual(sorted(union('D3')));
    expect(sorted(ITEM_IDS.D5)).toEqual(sorted([...union('D5', (s) => s.replace(/_\d+$/, '')), 'phoneDevices', 'otTotal']));
    expect(sorted(ITEM_IDS.RENTAL)).toEqual(sorted(union('RENTAL')));
  });

  it('no id is repeated within a label', () => {
    for (const label of ATO_LABELS) expect(new Set(ITEM_IDS[label]).size).toBe(ITEM_IDS[label].length);
  });
});
