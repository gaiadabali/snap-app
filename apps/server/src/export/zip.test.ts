import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { crc32, zip } from './zip.js';

/**
 * A hand-written ZIP writer has exactly one failure mode worth fearing: an
 * archive that this code is perfectly happy with and a real extractor refuses.
 * So the structural assertions here are backed by one test that unzips the
 * output with a tool that did not come from this repository.
 */
describe('crc32', () => {
  // The three standard vectors. If the table is built wrong these are the
  // fastest way to find out.
  it('matches the known vectors', () => {
    expect(crc32(Buffer.from(''))).toBe(0);
    expect(crc32(Buffer.from('a'))).toBe(0xe8b7_be43);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf4_3926);
  });

  it('is unsigned', () => {
    // The implementation works in signed 32-bit ints; a missing `>>> 0` gives
    // a negative number that writes as the right bytes and reads as nonsense.
    expect(crc32(Buffer.from('The quick brown fox'))).toBeGreaterThanOrEqual(0);
  });
});

describe('zip', () => {
  const entries = [
    { name: 'receipts/bp-gundagai.txt', bytes: Buffer.from('BP TRUCKSTOP GUNDAGAI $266.91') },
    { name: 'trips.csv', bytes: Buffer.from('date,from,to,km\n2026-09-10,Goulburn,Sydney,196.4\n') },
  ];

  it('starts with the local file header signature', () => {
    expect(zip(entries).readUInt32LE(0)).toBe(0x0403_4b50);
  });

  it('ends with an end-of-central-directory record naming every entry', () => {
    const out = zip(entries);
    const eocd = out.length - 22;
    expect(out.readUInt32LE(eocd)).toBe(0x0605_4b50);
    expect(out.readUInt16LE(eocd + 10)).toBe(2);
  });

  it('stores rather than compresses, so sizes match exactly', () => {
    const out = zip(entries);
    expect(out.readUInt16LE(8)).toBe(0); // method 0
    expect(out.readUInt32LE(18)).toBe(entries[0]!.bytes.length);
    expect(out.readUInt32LE(22)).toBe(entries[0]!.bytes.length);
  });

  it('marks names as UTF-8', () => {
    // Without the flag, a supplier with an accent in its name comes out
    // mangled on Windows.
    const out = zip([{ name: 'Café Roma.txt', bytes: Buffer.from('x') }]);
    expect(out.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it('refuses a duplicate name rather than shadowing one file with another', () => {
    expect(() => zip([entries[0]!, entries[0]!])).toThrow(/duplicate/);
  });

  it('produces a valid empty archive', () => {
    const out = zip([]);
    expect(out).toHaveLength(22);
    expect(out.readUInt32LE(0)).toBe(0x0605_4b50);
  });

  /**
   * The one test that matters. Everything above checks that the bytes are what
   * this file intended; this checks that something else agrees.
   */
  it('opens with a real extractor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'snap-zip-'));
    try {
      const archive = join(dir, 'pack.zip');
      writeFileSync(archive, zip(entries));

      // PowerShell ships with Windows and is not part of this project.
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${join(dir, 'out')}' -Force`,
        ],
        { stdio: 'pipe' },
      );

      expect(readFileSync(join(dir, 'out', 'receipts', 'bp-gundagai.txt')).toString()).toBe(
        'BP TRUCKSTOP GUNDAGAI $266.91',
      );
      expect(readFileSync(join(dir, 'out', 'trips.csv')).toString()).toContain('196.4');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // 30s, not vitest's default 5s. Spawning PowerShell costs seconds of
    // cold start before `Expand-Archive` does any work, and under the full
    // suite's parallel load it reliably overran — this test failed twice in
    // three runs while passing every time in isolation, which reads as a
    // broken archive writer and is actually a slow subprocess.
    //
    // Raised rather than skipped or mocked: the whole point of this test is
    // that something OTHER than our own writer agrees the bytes are a zip.
  }, 30_000);
});
