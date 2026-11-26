import { describe, expect, it } from 'vitest';
import { OccupationsCatalogueController } from './settings.controller.js';
import { occupationGroupsFor } from './occupation.js';

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
