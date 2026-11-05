/**
 * What does one scan cost? (group plan 7.4.b)
 *
 * Repeats the 2026-10-20 measurement: every vision model in the router's chain
 * reads every document in `bench/manifest.json`, with the production prompt and
 * the production request (the same `OpenRouterProvider`, so it asks for
 * `usage: { include: true }` and sends `provider.max_price`), and the charge
 * OpenRouter reports is converted to AUD at the rate in `call-cost.ts`.
 *
 * Rerun it whenever the model, the prompt or a price changes, then update
 * `docs/MONETISATION.md`. It spends real money, a few cents per run, so it is
 * deliberately NOT a test and refuses to run in CI.
 *
 *   OPENROUTER_API_KEY=... pnpm --filter @snap/server bench:cost -- --repeat 3 --models gemma4:31b
 *
 * The key comes from the environment (or `OLLAMA_ENV_FILE`, like the worker)
 * and is never printed. One page-set is one "scan"; a two-page invoice counts
 * as one scan with two images.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chain, openRouterModelId, type ModelSpec } from "../src/ai/router.js";
import { USD_TO_AUD } from "../src/extraction/call-cost.js";
import { toModelImages } from "../src/extraction/model-image.js";
import {
  OpenRouterProvider,
  readOpenRouterKey,
  type PageImage,
} from "../src/extraction/provider.js";

/** What a bought credit nets after GST and Stripe (A$0.027 to A$0.033). The low end. */
const CREDIT_NET_AUD = 0.027;

if (process.env.CI) {
  console.error("bench:cost spends real money and does not run in CI.");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const repeat = Math.max(1, Number(flag("repeat") ?? 3));
const only = flag("models")?.split(",");

const manifest = JSON.parse(
  readFileSync(join(HERE, "manifest.json"), "utf8"),
) as {
  documents: Array<{ id: string; pages: string[] }>;
};
const models: ModelSpec[] = chain("vision").filter(
  (m) => !only || only.includes(m.id),
);
if (models.length === 0) {
  console.error("No vision model matches --models.");
  process.exit(2);
}

const apiKey = readOpenRouterKey(); // throws without printing the key
const aud = (micros: number) => `A$${(micros / 1e6).toFixed(4)}`;

console.log(
  `rate USD to AUD ${USD_TO_AUD}; ${manifest.documents.length} documents x ${repeat} repeats\n`,
);
console.log(
  "model".padEnd(16) +
    "document".padEnd(20) +
    "ok".padEnd(6) +
    "in tok".padEnd(9) +
    "out tok".padEnd(9) +
    "per scan",
);

type Row = { model: string; scans: number; micros: number; failed: number };
const totals: Row[] = [];

for (const spec of models) {
  const total: Row = { model: spec.id, scans: 0, micros: 0, failed: 0 };
  for (const doc of manifest.documents) {
    const raw: PageImage[] = doc.pages.map((p) => ({
      bytes: readFileSync(join(HERE, p)),
      mimeType: "image/png",
    }));
    const { pages } = await toModelImages(raw);
    let ok = 0;
    let micros = 0;
    let tokIn = 0;
    let tokOut = 0;
    for (let i = 0; i < repeat; i++) {
      // A new provider per scan, so `modelCalls` holds exactly this scan's calls.
      const provider = new OpenRouterProvider(
        openRouterModelId(spec.id),
        undefined,
        apiKey,
      );
      const read = await provider.extract(pages).then(
        () => true,
        () => false, // an unreadable answer still has a charge, counted below
      );
      if (read) ok++;
      else total.failed++;
      for (const c of provider.modelCalls) {
        micros += c.costMicros ?? 0;
        tokIn += c.inputTokens ?? 0;
        tokOut += c.outputTokens ?? 0;
      }
      total.scans++;
    }
    total.micros += micros;
    console.log(
      spec.id.padEnd(16) +
        doc.id.padEnd(20) +
        `${ok}/${repeat}`.padEnd(6) +
        String(Math.round(tokIn / repeat)).padEnd(9) +
        String(Math.round(tokOut / repeat)).padEnd(9) +
        aud(micros / repeat),
    );
  }
  totals.push(total);
}

console.log("\naverage per scan, all documents (a failed call still costs):");
for (const t of totals) {
  const per = t.micros / t.scans;
  const verdict =
    per / 1e6 > CREDIT_NET_AUD ? "  LOSES MONEY against a credit" : "";
  console.log(
    `  ${t.model.padEnd(16)} ${aud(per)}  (${t.failed}/${t.scans} calls unusable)${verdict}`,
  );
}
console.log(
  `\ncredit nets about A$${CREDIT_NET_AUD}. Add the A$0.002 storage reserve and OpenRouter's 5.5% fee for the all-in figure.`,
);
