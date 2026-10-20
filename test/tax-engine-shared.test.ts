import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TAX ENGINE, SHARED BYTE FOR BYTE WITH FREE TAX RETURNS (group 1.8).
 *
 * `packages/tax-engine/src` is the SOURCE. Free Tax Returns keeps a copy at
 * `src/engine`, and its daily `engine-sync` workflow diffs that copy against
 * this folder on `main`. A change lands here first, then is copied across.
 *
 * Line endings are normalised (CRLF to LF) before hashing, because FTR's
 * checkout may differ by platform; the bytes that matter are the rest.
 */

const SRC = join(import.meta.dirname, '..', 'packages/tax-engine/src');

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/** sha256 over the sorted relative paths, each as path + "\n" + LF content + "\n". */
function engineTreeSha256(): string {
  const hash = createHash('sha256');
  for (const rel of listFiles(SRC).sort()) {
    const content = readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
    hash.update(`${rel}\n${content}\n`);
  }
  return hash.digest('hex');
}

/** Pinned here. Changing the engine means re-pinning this in the same PR, then copying the folder to FTR in a PR there. */
const ENGINE_TREE_SHA256 = 'eb31dea57a18cedfe35b143dbdc6dc6d87140c7d92b4222857d4c180485fb5b2';

describe('tax engine is the agreed bytes', () => {
  it('matches the pinned hash of packages/tax-engine/src', () => {
    expect(
      engineTreeSha256(),
      'This engine is shared byte for byte with Free Tax Returns\' `src/engine` ' +
        '(private repo gaiadabali/free-tax-return). Open a PR there with the same change, ' +
        'then re-pin ENGINE_TREE_SHA256 in test/tax-engine-shared.test.ts.',
    ).toBe(ENGINE_TREE_SHA256);
  });
});
