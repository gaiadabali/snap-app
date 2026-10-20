import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error plain ESM script with no declaration file; it has no dependencies.
import * as rn from '../deploy/release-notes.mjs';

/**
 * Release notes (1.12.d). Two things are checked: the script's rules, and the
 * real `apps/mobile/release-notes.json`, so a bad entry fails in the release PR
 * instead of at publish time.
 */
const REAL = join(import.meta.dirname, '..', 'apps', 'mobile', 'release-notes.json');

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'first-build',
  date: '2026-10-20',
  notes: 'One thing changed. Another thing changed too.',
  ...over,
});

describe('the real apps/mobile/release-notes.json', () => {
  const entries = JSON.parse(readFileSync(REAL, 'utf8'));

  it('is valid: schema, 2-5 sentences, at most 500 characters', () => {
    expect(rn.validateNotes(entries)).toEqual([]);
  });

  it('has a newest entry to publish', () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(rn.splitSentences(entries[0].notes).length).toBeGreaterThanOrEqual(2);
    expect(entries[0].notes.length).toBeLessThanOrEqual(500);
  });
});

describe('validateNotes', () => {
  it('accepts a good entry', () => {
    expect(rn.validateNotes([entry()])).toEqual([]);
  });

  it('rejects a non-array and an empty list', () => {
    expect(rn.validateNotes({})).toHaveLength(1);
    expect(rn.validateNotes([])).toHaveLength(1);
  });

  it('rejects a bad id, a bad date and unknown fields', () => {
    expect(rn.validateNotes([entry({ id: 'Bad Id' })]).join()).toMatch(/id must be/);
    expect(rn.validateNotes([entry({ date: '2026-02-30' })]).join()).toMatch(/real YYYY-MM-DD/);
    expect(rn.validateNotes([entry({ date: '20/10/2026' })]).join()).toMatch(/real YYYY-MM-DD/);
    expect(rn.validateNotes([entry({ versionCode: 5 })]).join()).toMatch(/unknown field/);
  });

  it('rejects duplicate ids', () => {
    expect(rn.validateNotes([entry(), entry()]).join()).toMatch(/used twice/);
  });

  it('counts sentences: one is too few, six are too many', () => {
    expect(rn.validateNotes([entry({ notes: 'Only one sentence.' })]).join()).toMatch(/1 sentence/);
    const six = 'A one. B two. C three. D four. E five. F six.';
    expect(rn.validateNotes([entry({ notes: six })]).join()).toMatch(/6 sentence/);
    const five = 'A one. B two. C three. D four. E five.';
    expect(rn.validateNotes([entry({ notes: five })])).toEqual([]);
  });

  it('enforces the 500 character limit exactly', () => {
    const pad = (n: number) => `Short one. ${'x'.repeat(n - 'Short one. '.length - 1)}.`;
    expect(pad(500)).toHaveLength(500);
    expect(rn.validateNotes([entry({ notes: pad(500) })])).toEqual([]);
    expect(rn.validateNotes([entry({ notes: pad(501) })]).join()).toMatch(/501 characters/);
  });

  it('rejects line breaks, stray whitespace and a missing full stop', () => {
    expect(rn.validateNotes([entry({ notes: 'One.\nTwo.' })]).join()).toMatch(/line breaks/);
    expect(rn.validateNotes([entry({ notes: ' One. Two.' })]).join()).toMatch(/whitespace/);
    expect(rn.validateNotes([entry({ notes: 'One. Two' })]).join()).toMatch(/full stop/);
  });

  it('requires newest first', () => {
    const list = [entry({ id: 'old-one', date: '2026-09-01' }), entry({ id: 'new-one', date: '2026-10-01' })];
    expect(rn.validateNotes(list).join()).toMatch(/newest first/);
    expect(rn.validateNotes([...list].reverse())).toEqual([]);
  });
});

describe('pickEntry', () => {
  const entries = [entry({ id: 'newest' }), entry({ id: 'older' })];

  it('takes the newest entry when nothing is published', () => {
    expect(rn.pickEntry(entries, []).status).toBe('new');
    expect(rn.pickEntry(entries, []).entry.id).toBe('newest');
  });

  it('is still new when only an OLDER entry is published', () => {
    const r = rn.pickEntry(entries, [{ id: 'older', versionCode: 5 }]);
    expect(r.status).toBe('new');
    expect(r.entry.id).toBe('newest');
  });

  it('refuses an id that is already attached to a published build', () => {
    const r = rn.pickEntry(entries, [{ id: 'newest', versionCode: 7, version: '0.1.7' }]);
    expect(r.status).toBe('published');
    expect(r.release.versionCode).toBe(7);
  });

  it('lets the SAME build resume a half-finished publish, and no other build', () => {
    const published = [{ id: 'newest', versionCode: 7 }];
    expect(rn.pickEntry(entries, published, 7).status).toBe('resume');
    expect(rn.pickEntry(entries, published, 8).status).toBe('published');
  });
});

describe('the draft', () => {
  it('lists commit subjects and says they are not customer copy', () => {
    const text = rn.formatDraft(['Revert "x"', 'The gap check counts in BigInt'], 'abc1234');
    expect(text).toContain('since the last published build (abc1234)');
    expect(text).toContain('  - Revert "x"');
    expect(text).toContain('  - The gap check counts in BigInt');
    expect(text).toMatch(/not customer copy/);
  });

  it('asks git for the range since the published commit, limited to the two folders', () => {
    const calls: string[][] = [];
    const run = (_cmd: string, args: string[]) => {
      calls.push(args);
      return 'One\nTwo\n';
    };
    const text = rn.draftFor({ commit: 'e228773' }, run);
    expect(calls[0]).toEqual(['log', '--no-merges', '--format=%s', 'e228773..HEAD', '--', 'apps/mobile', 'packages']);
    expect(text).toContain('  - One');
    expect(text).toContain('  - Two');
  });

  it('falls back to recent commits when the published commit is not in this clone', () => {
    const run = (_cmd: string, args: string[]) => {
      if (args.includes('e228773..HEAD')) throw new Error('bad revision');
      return 'Recent\n';
    };
    const text = rn.draftFor({ commit: 'e228773' }, run);
    expect(text).toContain('last published commit is unknown');
    expect(text).toContain('  - Recent');
  });

  it('does not pass a hostile manifest commit to git', () => {
    const calls: string[][] = [];
    rn.draftFor({ commit: '--output=/tmp/x' }, (_c: string, a: string[]) => {
      calls.push(a);
      return '';
    });
    expect(calls.every((a) => !a.some((x) => x.includes('--output')))).toBe(true);
  });
});

describe('main (the CLI the publish script and CI call)', () => {
  let dir: string;
  const capture = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };
  const write = (name: string, value: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    return p;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'snap-rn-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const notes = () => write('notes.json', [entry({ id: 'newest' }), entry({ id: 'older', date: '2026-09-01' })]);
  const buildFlags = () => [
    '--version', '0.1.300', '--version-code', '300', '--commit', 'abc1234',
    '--published-at', '2026-10-21T01:00:00Z', '--sha256', 'f'.repeat(64), '--size', '1000',
    '--api-url', 'https://api.example',
  ];

  it('check passes on a good file and fails on a bad one', () => {
    const good = capture();
    expect(rn.main(['check', '--notes', notes()], good.io)).toBe(0);
    const bad = capture();
    expect(rn.main(['check', '--notes', write('bad.json', [entry({ notes: 'One.' })])], bad.io)).toBe(1);
    expect(bad.err.join('\n')).toMatch(/1 sentence/);
  });

  it('pick treats a missing or corrupt releases file as "nothing published"', () => {
    for (const releases of [join(dir, 'does-not-exist.json'), write('corrupt.json', '{ nope')]) {
      const c = capture();
      expect(rn.main(['pick', '--notes', notes(), '--releases', releases], c.io)).toBe(0);
      expect(JSON.parse(c.out[0]).entry.id).toBe('newest');
    }
  });

  it('pick refuses an already-published newest entry and prints the draft', () => {
    const c = capture();
    const releases = write('r1.json', [{ id: 'newest', versionCode: 250, version: '0.1.250' }]);
    const manifest = write('m1.json', { commit: 'not-hex!' });
    const code = rn.main(['pick', '--notes', notes(), '--releases', releases, '--manifest', manifest], c.io);
    expect(code).toBe(1);
    const text = c.err.join('\n');
    expect(text).toMatch(/already attached to build 250/);
    expect(text).toMatch(/not customer copy/);
  });

  it('plan writes releases.json and a manifest that carries the notes', () => {
    const outReleases = join(dir, 'out-releases.json');
    const outManifest = join(dir, 'out-manifest.json');
    const releases = write('r2.json', [{ id: 'older', versionCode: 200, version: '0.1.200', commit: 'a', publishedAt: 'x', notes: 'Old. Notes.' }]);
    const c = capture();
    const code = rn.main(
      ['plan', '--notes', notes(), '--releases', releases, '--out-releases', outReleases, '--out-manifest', outManifest, ...buildFlags()],
      c.io,
    );
    expect(code).toBe(0);
    const r = JSON.parse(readFileSync(outReleases, 'utf8'));
    expect(r.map((x: { id: string }) => x.id)).toEqual(['newest', 'older']);
    expect(r[0]).toEqual({
      id: 'newest', versionCode: 300, version: '0.1.300', commit: 'abc1234',
      publishedAt: '2026-10-21T01:00:00Z', notes: 'One thing changed. Another thing changed too.',
    });
    const m = JSON.parse(readFileSync(outManifest, 'utf8'));
    expect(m).toMatchObject({
      version: '0.1.300', versionCode: 300, buildNumber: 'abc1234', commit: 'abc1234',
      byteSize: 1000, apiUrl: 'https://api.example', notes: 'One thing changed. Another thing changed too.',
    });
  });

  it('plan on a first publish (no releases file) starts the history', () => {
    const outReleases = join(dir, 'first-releases.json');
    const c = capture();
    const code = rn.main(
      ['plan', '--notes', notes(), '--releases', join(dir, 'nope.json'), '--out-releases', outReleases, '--out-manifest', join(dir, 'first-m.json'), ...buildFlags()],
      c.io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(outReleases, 'utf8'))).toHaveLength(1);
  });

  it('plan resumes the same build without duplicating its entry', () => {
    const outReleases = join(dir, 'resume-releases.json');
    const releases = write('r3.json', [{ id: 'newest', versionCode: 300, version: '0.1.300' }]);
    const c = capture();
    const code = rn.main(
      ['plan', '--notes', notes(), '--releases', releases, '--out-releases', outReleases, '--out-manifest', join(dir, 'resume-m.json'), ...buildFlags()],
      c.io,
    );
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(outReleases, 'utf8'))).toHaveLength(1);
    expect(c.out[0]).toMatch(/^resume:/);
  });

  it('plan refuses the newest entry once another build holds it, and writes nothing', () => {
    const outReleases = join(dir, 'refused-releases.json');
    const releases = write('r4.json', [{ id: 'newest', versionCode: 250, version: '0.1.250' }]);
    const c = capture();
    const code = rn.main(
      ['plan', '--notes', notes(), '--releases', releases, '--out-releases', outReleases, '--out-manifest', join(dir, 'refused-m.json'), ...buildFlags()],
      c.io,
    );
    expect(code).toBe(1);
    expect(() => readFileSync(outReleases)).toThrow();
  });

  it('refuses an unknown command and a missing flag value', () => {
    expect(rn.main(['nope'], capture().io)).toBe(2);
    expect(rn.main(['check', '--notes'], capture().io)).toBe(2);
  });
});
