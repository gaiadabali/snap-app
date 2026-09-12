/**
 * Run extraction against a real image.
 *
 *   pnpm --filter @snap/server extract <image> [--model gemma4:31b]
 *
 * Deliberately a command and not a test: it costs money, needs a network, and
 * its output depends on a model that can change under us. The test suite
 * covers the half that is decidable — the validators — and this covers the
 * half that is not.
 *
 * Reads the provider key from OLLAMA_API_KEY, or from the file named by
 * OLLAMA_ENV_FILE. The key is never printed.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { OllamaCloudProvider } from '../src/extraction/provider.js';
import { runExtraction, toDocument } from '../src/extraction/run.js';

const args = process.argv.slice(2);
const imagePath = args.find((a) => !a.startsWith('--'));
const modelFlag = args.indexOf('--model');
const model = modelFlag >= 0 ? args[modelFlag + 1] : undefined;

if (!imagePath) {
  console.error('usage: extract <image.jpg|png> [--model gemma4:31b]');
  process.exit(2);
}

const bytes = readFileSync(imagePath);
const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

const provider = new OllamaCloudProvider(model);
console.log(`extracting ${basename(imagePath)} (${Math.round(bytes.byteLength / 1024)} KB)`);
console.log(`provider   ${provider.name} · ${provider.model}\n`);

const outcome = await runExtraction(provider, { bytes, mimeType });

if (!outcome.ok) {
  const { failure } = outcome;
  console.error(`FAILED at the ${failure.stage} stage after ${failure.meta.totalMs} ms`);
  console.error(failure.error);
  if (failure.raw) console.error(`\nraw response:\n${failure.raw.slice(0, 800)}`);
  process.exit(1);
}

const { run } = outcome;
const doc = toDocument(run);

const money = (v: string | null) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

console.log('── read ────────────────────────────────────────────');
console.log(`supplier     ${doc.supplierName ?? '—'}`);
console.log(`ABN          ${doc.supplierAbn ?? '—'}  ${doc.supplierAbnValid ? '(checksum ok)' : '(invalid or absent)'}`);
console.log(`date         ${doc.issueDate ?? '—'}`);
console.log(`total        ${money(doc.payableAmount)}`);
console.log(`GST          ${money(doc.taxAmount)}`);
console.log(`GST-free     ${money(doc.gstFreeAmount)}`);
console.log(`tax invoice  ${doc.isTaxInvoice ? 'yes' : 'no'}`);
console.log(`confidence   ${Math.round(doc.confidenceOverall * 100)}%`);

console.log(`\n── ${doc.lines.length} line(s) ${doc.linesBalance ? '(they balance)' : '(THEY DO NOT BALANCE)'} ──`);
for (const l of doc.lines) {
  const qty = l.quantity > 1 ? `${l.quantity} × ` : '';
  console.log(`  ${qty}${l.description.padEnd(30).slice(0, 30)} ${money(l.amount).padStart(10)}${l.gstFree ? '  GST-free' : ''}`);
}

if (doc.complianceFailures.length > 0) {
  // Only a figure when there IS one: a document with no GST stated has
  // nothing at risk, and printing "$—  at risk" reads as a bug.
  const heading = doc.gstAtRisk ? `${money(doc.gstAtRisk)} at risk` : 'not a valid tax invoice';
  console.log('\n── compliance ──────────────────────────────────────');
  console.log(`  ${heading} — ${doc.complianceFailures.join(', ')}`);
  if (doc.belowTaxInvoiceThreshold) {
    console.log('  under $82.50, so the ATO does not require a tax invoice here');
  }
}

if (doc.findings.length > 0) {
  console.log('\n── findings ────────────────────────────────────────');
  for (const f of doc.findings) {
    console.log(`  [${f.severity}] ${f.field}: ${f.message}`);
    if (f.fix) console.log(`            ${f.fix}`);
  }
} else {
  console.log('\nno findings — nothing needs a human');
}

console.log(
  `\nreview       ${doc.reviewStatus}` +
    `\nsha256       ${run.sha256.slice(0, 16)}…` +
    `\nlatency      ${run.meta.latencyMs} ms` +
    `\ntokens       ${run.meta.inputTokens ?? '?'} in / ${run.meta.outputTokens ?? '?'} out` +
    `\nprompt       ${run.meta.promptVersion}`,
);
