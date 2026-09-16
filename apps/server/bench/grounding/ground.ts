/**
 * Grounding shim: run the SHIPPED grounding code over a DocDOM from the bench.
 *
 * `docs/contracts/phase1c-grounding.md` decided grounding would be advisory —
 * stored, not enforced — with an explicit reason: *"we have a grounding rate
 * from one document. We do not know the false-positive rate, and the failure
 * mode of getting this wrong is a review queue full of 'unsupported value'
 * warnings on values that were read perfectly."* It ends: **store first,
 * measure, promote on evidence.**
 *
 * This is the measuring instrument. The corpus now has ~400 documents with
 * committed ground truth and the OCR sidecar is deployable, so the question
 * that contract left open can finally be answered with a number.
 *
 * WHY A SHIM RATHER THAN A PYTHON REIMPLEMENTATION. The bench is Python and
 * `groundValue` is TypeScript, and the tempting shortcut is to port the
 * matching logic. That would measure a *port*, not the thing that ships, and
 * the two would drift on the first normalisation change — the same argument
 * `docs/ON-DEVICE.md` §6.4 makes for running the structurer "via a tiny Node
 * shim, so it is the same TS code the app ships".
 *
 * Reads one JSON object on stdin: `{ doc, fields }`, exactly the arguments of
 * `groundExtraction`. Writes its `GroundingReport` on stdout.
 *
 *   echo '{"doc":...,"fields":[...]}' | pnpm exec tsx bench/grounding/ground.ts
 */
import { groundExtraction, type FieldToGround } from '@snap/docai';
import type { Document } from '@snap/docai/docdom';

type Payload = { doc: Document; fields: FieldToGround[] };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const main = async (): Promise<void> => {
  const raw = await readStdin();
  if (!raw.trim()) {
    process.stderr.write('ground.ts: empty stdin — expected {"doc":...,"fields":[...]}\n');
    process.exit(2);
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch (error) {
    process.stderr.write(`ground.ts: stdin is not valid JSON: ${String(error)}\n`);
    process.exit(2);
    return;
  }

  // Deliberately NOT defensive about the shapes below. A malformed DocDOM
  // should throw here, loudly, rather than be coerced into something that
  // grounds against nothing and reports a 0% rate that looks like a finding
  // about the engine.
  const report = groundExtraction(payload.doc, payload.fields);
  process.stdout.write(JSON.stringify(report));
};

void main();
