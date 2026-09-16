/**
 * Bench shim for the GROUNDED extraction path — the pointing model, end to end.
 *
 * Reads `{ doc, refs }` on stdin, where `refs` is exactly what the model
 * returned, and writes the resolved fields. Uses the SHIPPED `grounded.ts`, not
 * a bench copy: a port would measure the port and drift on the first change,
 * the same argument `ground.ts` makes and `docs/ON-DEVICE.md` §6.4 makes for
 * the structurer.
 *
 * Also exposes the span catalogue, so the Python side can build the prompt
 * without knowing DocDOM's shape.
 *
 *   echo '{"mode":"catalogue","doc":...}' | pnpm exec tsx bench/grounding/point.ts
 *   echo '{"mode":"resolve","doc":...,"refs":{...}}' | pnpm exec tsx bench/grounding/point.ts
 */
import {
  renderSpanCatalogue,
  resolveAll,
  type PointedField,
  type SpanRef,
} from '../../src/extraction/grounded';
import type { Document } from '@snap/docai';

type Payload =
  | { mode: 'catalogue'; doc: Document; limit?: number }
  | { mode: 'resolve'; doc: Document; refs: Partial<Record<PointedField, SpanRef | null>> };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const main = async (): Promise<void> => {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write('point.ts: empty stdin\n');
    process.exit(2);
  }
  const payload = JSON.parse(raw) as Payload;

  if (payload.mode === 'catalogue') {
    process.stdout.write(
      JSON.stringify({ catalogue: renderSpanCatalogue(payload.doc, payload.limit ?? 1200) }),
    );
    return;
  }

  // Deliberately not defensive about the reply's shape. A model that returned
  // something unparseable should fail here loudly rather than be coerced into
  // an empty result that scores as a clean abstention — which would flatter the
  // pointing path in exactly the way this run exists to detect.
  process.stdout.write(JSON.stringify(resolveAll(payload.doc, payload.refs)));
};

void main();
