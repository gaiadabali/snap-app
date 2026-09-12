import { describe, expect, it } from 'vitest';
import { PROFILES } from './index';
import { OCC_FLOW, occIndustries, occOccupations, occQ3Needed, occResolve, occRoleAreas } from './occ-flow';

describe('occupation cascade (OCC_FLOW)', () => {
  it('every leaf resolves to a real engine profile', () => {
    for (const leaf of OCC_FLOW) {
      expect(PROFILES[leaf.engine], `missing profile for ${leaf.engine}`).toBeDefined();
    }
  });

  it('industries are distinct and non-empty', () => {
    const inds = occIndustries();
    expect(inds.length).toBeGreaterThan(5);
    expect(new Set(inds).size).toBe(inds.length);
  });

  it('role areas depend on the chosen industry', () => {
    const areas = occRoleAreas('Education and Training');
    expect(areas).toContain('Primary School Teachers');
    expect(occRoleAreas('does-not-exist')).toEqual([]);
  });

  it('resolves a direct (no-q3) role area to its engine', () => {
    expect(occQ3Needed('Education and Training', 'Primary School Teachers')).toBe(false);
    const leaf = occResolve('Education and Training', 'Primary School Teachers');
    expect(leaf?.engine).toBe('teacher');
  });

  it('requires q3 for role areas with named occupations', () => {
    expect(occQ3Needed('Healthcare, Carers, Special Needs and Social Workers', 'Nurse')).toBe(true);
    expect(occOccupations('Healthcare, Carers, Special Needs and Social Workers', 'Nurse')).toContain('Enrolled Nurses');
    // Without q3 → unresolved; with q3 → the nurse engine.
    expect(occResolve('Healthcare, Carers, Special Needs and Social Workers', 'Nurse')).toBeUndefined();
    expect(occResolve('Healthcare, Carers, Special Needs and Social Workers', 'Nurse', 'Enrolled Nurses')?.engine).toBe('nurse');
  });

  it('a forklift title routes to the forklift engine, not the generic equipop', () => {
    const leaf = occResolve('Manufacturing & Production', 'Factory Machine Operators', 'Forklift Drivers - carry toolbox for check and minor maintenance');
    expect(leaf?.engine).toBe('forklift');
  });
});
