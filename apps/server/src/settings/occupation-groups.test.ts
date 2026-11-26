import { describe, expect, it } from 'vitest';
import { OccupationsCatalogueController } from './settings.controller.js';
import { OCCUPATION_GROUPS, PROFILES } from '@snap/tax-engine';
import { occupationAllowed, occupationGroupsFor } from './occupation.js';

const ids = (kind: 'personal' | 'business') =>
  occupationGroupsFor(kind).flatMap((g) => g.profiles.map((p) => p.id));

describe('occupationGroupsFor', () => {
  it('is non-empty for both kinds and has no empty groups', () => {
    for (const kind of ['personal', 'business'] as const) {
      const groups = occupationGroupsFor(kind);
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((g) => g.profiles.length > 0)).toBe(true);
    }
  });
  it('offers the sole trader to a business only', () => {
    expect(ids('personal')).not.toContain('sole');
    expect(ids('business')).toContain('sole');
  });
});

describe('occupationGroupsFor de-duplication', () => {
  it('never offers the same id twice', () => {
    for (const kind of ['personal', 'business'] as const) {
      const all = ids(kind);
      expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
    }
  });
  it('still offers every id that was offered before', () => {
    for (const kind of ['personal', 'business'] as const) {
      const before = new Set(
        OCCUPATION_GROUPS.flatMap((g) => g.ids).filter(
          (id: string) => PROFILES[id] !== undefined && occupationAllowed(kind, id),
        ),
      );
      expect(new Set(ids(kind))).toEqual(before);
    }
  });
  it('drops the FIFO and DIDO groups, whose jobs live under their trades', () => {
    const labels = occupationGroupsFor('business').map((g) => g.group);
    expect(labels.some((l) => /FIFO|DIDO/.test(l))).toBe(false);
    expect(ids('business')).toContain('miner');
  });
});

describe('OccupationsCatalogueController (pre-workspace, unguarded)', () => {
  const c = new OccupationsCatalogueController();
  it('defaults to personal and honours ?kind=business', () => {
    expect(c.list()).toEqual(occupationGroupsFor('personal'));
    expect(c.list('bogus')).toEqual(occupationGroupsFor('personal'));
    expect(c.list('business')).toEqual(occupationGroupsFor('business'));
  });
  it('carries no guard metadata, so an anonymous caller is served', () => {
    expect(Reflect.getMetadata('__guards__', OccupationsCatalogueController)).toBeUndefined();
  });
});
