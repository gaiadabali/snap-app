import { describe, expect, it } from 'vitest';

import { computeBuild } from './build-version.cjs';

const git = (count: string | number, shallow = false) => () => ({ count, shallow });
const boom = () => {
  throw new Error('git must not be asked when there is an override');
};

describe('computeBuild', () => {
  it('uses the commit count as versionCode', () => {
    expect(computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git('218') }).versionCode).toBe(218);
    expect(computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git(1) }).versionCode).toBe(1);
  });

  it('builds the version from app.json major.minor plus the count', () => {
    const r = computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git('218') });
    expect(r).toEqual({ versionCode: 218, version: '0.1.218' });
    expect(computeBuild({ appVersion: '2.7.9', override: undefined, readGit: git(5) }).version).toBe('2.7.5');
    expect(computeBuild({ appVersion: '3.4', override: undefined, readGit: git(5) }).version).toBe('3.4.5');
  });

  it('rises with every commit', () => {
    const at = (n: number) => computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git(n) }).versionCode;
    expect(at(219)).toBeGreaterThan(at(218));
  });

  it('takes SNAP_BUILD_NUMBER over git, and never asks git', () => {
    const r = computeBuild({ appVersion: '0.1.0', override: '1234', readGit: boom });
    expect(r).toEqual({ versionCode: 1234, version: '0.1.1234' });
  });

  it('works on a shallow clone when the number is given', () => {
    const r = computeBuild({ appVersion: '0.1.0', override: '77', readGit: git(1, true) });
    expect(r.versionCode).toBe(77);
  });

  it('ignores a blank override, as compose and CI pass unset variables as ""', () => {
    expect(computeBuild({ appVersion: '0.1.0', override: '  ', readGit: git(9) }).versionCode).toBe(9);
  });

  it('REFUSES a shallow clone with no override, because it would count 1', () => {
    expect(() => computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git(1, true) })).toThrow(
      /shallow/i,
    );
  });

  it('refuses a bad override or a bad count rather than guessing', () => {
    for (const bad of ['abc', '0', '-3', '1.5', '2100000001']) {
      expect(() => computeBuild({ appVersion: '0.1.0', override: bad, readGit: boom })).toThrow(/SNAP_BUILD_NUMBER/);
    }
    for (const bad of ['', 'x', '0']) {
      expect(() => computeBuild({ appVersion: '0.1.0', override: undefined, readGit: git(bad) })).toThrow(/commit count/);
    }
  });

  it('refuses an app.json version without major.minor', () => {
    expect(() => computeBuild({ appVersion: '1', override: '5', readGit: boom })).toThrow(/major\.minor/);
    expect(() => computeBuild({ appVersion: undefined as unknown as string, override: '5', readGit: boom })).toThrow();
  });
});
