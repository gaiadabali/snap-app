/**
 * Bench shim for the on-device structurer — OD-5.
 *
 * Runs the SHIPPED `@snap/docai-preview` over a DocDOM read on stdin. Not a
 * bench copy of the rules: a port would measure the port and drift on the
 * first change, which is the argument `docs/ON-DEVICE.md` §6.4 step 3 makes
 * for using "a tiny Node shim, so it is the same TS code the app ships".
 *
 *   echo '{"doc":...}' | pnpm exec tsx bench/grounding/preview.ts
 */
import { structure } from '@snap/docai-preview';
import type { Document } from '@snap/api-contract/docdom';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const main = async (): Promise<void> => {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write('preview.ts: empty stdin — expected {"doc":...}\n');
    process.exit(2);
  }
  const { doc } = JSON.parse(raw) as { doc: Document };
  // Deliberately undefended: a malformed DocDOM should throw loudly rather
  // than be coerced into an empty result that scores as a clean abstention,
  // which would flatter the preview in exactly the way this run exists to test.
  process.stdout.write(JSON.stringify(structure(doc)));
};

void main();
