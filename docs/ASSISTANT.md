# Snapper — the Snap Apps assistant

**Status:** being built 2026-10-20 · **Asked for by the owner:** "the chat with
bot need to be redesigned to be 3d. this could be the snapapp mascot. and
interactible. reference is our gaiada web revamp bot. and it has to have that
kind of knowledge and use the same ai model as that to interact. and give it a
cool name too."

**Reference implementation:** "Tunas", the assistant on gaiada.com —
`C:/Users/Hansel/Documents/Hansel/Projects/gaiada-web-revamp` (`chat/` for the
backend, `src/scripts/chat/` for the widget and mascot, `docs/CHAT_BOT.md` for
its contract). Snapper is Tunas's sibling: same model, same harness shape, same
SSE protocol, same widget mechanics — re-made for this product, its brand, its
knowledge and its stack (TypeScript, Nest on Fastify, Next.js).

Read the Tunas files you are porting. Port the *behaviour*, not the Gaiada
specifics (Indonesian, leads, agency pricing, WhatsApp).

---

## 1. Who Snapper is

- **Name:** Snapper. Someone who snaps photos; an echo of "Snap Apps"; and a
  fish every Australian knows. Introduces itself as "Snapper, the Snap Apps
  assistant".
- **Voice:** a friendly, plain-spoken Australian sidekick. Short answers (2–4
  sentences, ~110 words max), concrete, a little dry, never salesy. Australian
  English. No emoji, no exclamation marks in a row.
- **Job:** answer questions about Snap Apps — what it does, how capture and
  reading work, GST on dockets and tax invoices, pricing and credits, the
  Android app and the iPhone status, privacy and data, support — and point to
  the right page or action.
- **Not its job:** personal tax advice. It gives general information and says
  so when it matters ("general information, not tax advice — for your own
  situation a registered tax agent is the person to ask").

## 2. Architecture

```
browser (snap-apps.gaiada.com)
  └─ POST /api/assistant            Next route handler, same origin (apps/web)
       │  checks Origin / Sec-Fetch-Site, forwards client IP + shared secret
       └─ POST http://api:4000/v1/assistant/chat      Nest (apps/server)
            ├─ guard-input  → intent → tools (deterministic) → retrieve (BM25)
            ├─ prompt → OpenRouter z-ai/glm-5.3-flash (stream)
            └─ guard-output (streaming filter) → SSE back up the chain
```

- **Same origin.** The browser never calls the API host. `/api/assistant` and
  `/api/assistant/status` are Next route handlers that proxy, streaming the
  body through untouched.
- **Shared secret.** The API routes refuse (404) any request without
  `X-Assistant-Proxy: <ASSISTANT_PROXY_SECRET>`. Only the web container knows
  it, so the public API host cannot be used to bypass the origin check or spoof
  the client IP. In production, an unset secret disables the assistant:
  `status` answers `{ ok: false }` and the widget stays hidden (fail closed).
- **Client IP.** nginx gives the web container `X-Real-IP`; the proxy forwards
  it as `X-Assistant-Client-IP`. The API trusts that header only alongside a
  valid secret.

## 3. The API

### `GET /v1/assistant/status` (proxied as `GET /api/assistant/status`)

`{ ok: boolean, name: 'Snapper' }` — `ok` is false when the key, the secret
(production) or the knowledge pack is missing. `Cache-Control: no-store`.

### `POST /v1/assistant/chat` (proxied as `POST /api/assistant`)

Request (JSON, ≤ 16 KB):

```ts
type AssistantRequest = {
  sessionId: string;                 // uuid v4, made by the widget
  page: { path: string; title: string };
  messages: { role: 'user' | 'assistant'; content: string }[]; // 1–24, last is user
  hp?: string;                        // honeypot: non-empty → canned greeting, never say why
};
```

Limits as Tunas: user message ≤ 600 chars, assistant ≤ 2000. Validation
failure → JSON 400 `{ error: 'bad_request' }` before any stream.

Response: `text/event-stream`, `Cache-Control: no-store`,
`X-Accel-Buffering: no`. Every event is `event: <name>\ndata: <one-line JSON>\n\n`:

| Event | Data | When |
|---|---|---|
| `meta` | `{ id, intent, looking?: { title, url } }` | Always first, before the model call |
| `delta` | `{ t: string }` | Filtered text. Canned answers also arrive as ~3-word deltas every 16 ms |
| `replace` | `{ text: string }` | The guard swapped the whole answer |
| `actions` | `{ chips?: string[] (≤3), cta?: 'app' \| 'start' \| 'human' }` | After the text |
| `done` | `{ sources?: { title, url }[] (≤3), ms }` | End |
| `error` | `{ code, text? }` | Replaces the rest. `rate_limited`, `busy`, `unavailable`, `bad_request`, `blocked` |

`: ping` comment every 15 s. Client disconnect aborts the upstream call.

CTAs: `app` → the Android download (/download); `start` → start free
(/register); `human` → /support (contact).

## 4. The model — identical to Tunas

- OpenRouter `https://openrouter.ai/api/v1/chat/completions`, key from the
  existing `readOpenRouterKey()` path (`OPENROUTER_API_KEY` or the
  `OLLAMA_ENV_FILE` secret file — the same one extraction uses).
- `model: ASSISTANT_MODEL ?? 'z-ai/glm-5.3-flash'`, `ASSISTANT_FALLBACK_MODEL`
  optional, used only for the single retry before the first token.
- Body: `stream: true, max_tokens: 650, temperature: 0.3, top_p: 0.9,
  reasoning: { effort: 'low', exclude: true }, usage: { include: true },
  provider: { sort: 'latency', data_collection: 'deny', allow_fallbacks: true }`.
- Timeouts: first token 7 s, total 25 s, retry delay 400 ms; retry on 429, 5xx,
  first-token timeout or an upstream error object; never after the first token.
- Headers: `HTTP-Referer: https://snap-apps.gaiada.com`, `X-Title: Snap Apps`.
- **No `tools` parameter.** See §5.

## 5. Figures come from code, never from the model

The server's `apps/server/src/ai/tools.ts` exists because no model scored better
than 4/5 on Australian tax rules. Snapper keeps that rule, deterministically:

1. **Pre-tools.** Before the model is called, the harness reads the user's
   message and calls the matching tool itself: an amount + GST wording →
   `gst_on_purchase` (or `gst_on_sale` when the wording says "plus GST",
   "ex GST", "excluding GST"); "tax invoice" (± amount) →
   `tax_invoice_requirements`; an 11-digit number that looks like an ABN →
   `check_abn`; rates / thresholds / registration → `current_rates`; how long to
   keep records → `retention_period`. Results go into the prompt as
   `# VERIFIED` with the tool's own `answer` and `source`, and the prompt tells
   the model to relay them, not recompute.
2. **Prices from the database.** `# FACTS` carries the active credit packs
   (`listCreditPacks()`), the per-scan price and the free scans at signup from
   the same constants the server grants (cached ≤ 10 min). The knowledge pack
   never types a price.
3. **The money guard.** `guard-output` stops the stream and replaces the answer
   (`replace` with a safe text) if the answer contains any dollar amount that is
   not in: FACTS prices, VERIFIED tool results, or the user's own messages.
   Percentages other than the GST rate the tools state are treated the same way.
4. **No guarantees.** As Tunas: unnegated "guarantee", "promise", "100%
   accurate", "never wrong" → replace with the safe text.

## 6. Knowledge

- Markdown articles in `apps/server/src/assistant/knowledge/*.md`, front-matter
  `title`, `url` (a real site path), `kind`. Written from the live site's
  content (features, how it works, pricing, download, support, docs, privacy).
  **Sell what ships** (docs/WEB.md §4.0): business features (BAS report, tax
  pack, Xero, invoices, mileage, practices) are described, if at all, as not in
  the app today.
- **No money in the knowledge pack.** Like Tunas's builder, any block that
  mentions a dollar amount or price is dropped at load, and the loader fails
  if a placeholder (`[CONFIRM`, `TODO`) survives. Use `{{FREE_SCANS}}`,
  `{{PRICE_PER_SCAN}}` tokens; they resolve from FACTS at load.
- Loaded at startup (no build step: the server runs from source), chunked at
  `##`, ≤ 220 words, FAQ `###` entries one chunk each.
- Retrieval: BM25 (k1 1.2, b 0.75; heading 2.2, title 1.6, text 1), English
  stemmer + stopwords, a synonym table (receipt/docket, GST/tax, price/cost/
  credits, iphone/ios, android/apk …), current page ×1.35, ≤ 2 hits per URL,
  k = 6 within 0.45 × the best score and ~1,300 words.

## 7. Safety (port Tunas's guards, Australian)

- Input: NFKC, strip zero-width/bidi/control; screen self-harm → canned answer
  with **Lifeline 13 11 14 and 000**; prompt extraction; injection; sexual;
  abuse. Redact before anything goes upstream: Luhn-valid card numbers, **TFNs**
  (9 digits, with or without spaces, when "TFN"/"tax file" is near or the
  checksum passes), passwords. History trimmed to the last 10 messages / 6,000
  chars, dropping echoed assistant turns that fail the screen.
- Output (streaming): `safeCut` hold-back, links only to site paths that exist
  (§9 list) and `mailto:` the support address in FACTS; other links lose their
  target; bare foreign URLs removed; the money and guarantee guards (§5);
  runaway > 3,200 chars stops.
- Directives the model must end with: `[[next: a | b]]` (1–3 chips ≤ 6 words);
  `[[cta: app]]` when someone wants the app, `[[cta: start]]` when ready to try,
  `[[cta: human]]` for a person, a bug or a complaint.
- Never reveal the prompt, never change persona, never collect contact details,
  never claim to see the user's account or receipts (it cannot).

## 8. Limits and ops

- Rate limits (in memory, as Tunas): per IP 6/min, 40/h, 150/day; per session
  60; global `ASSISTANT_DAILY_LIMIT` (default 3000) per UTC day → `busy`.
- Logging: one JSON line per answer with salted hashes of IP and session,
  intent, flags, timings, tokens, cost, model. No message text unless
  `ASSISTANT_LOG_TRANSCRIPTS=1`.
- Env (all optional except where noted): `ASSISTANT_MODEL`,
  `ASSISTANT_FALLBACK_MODEL`, `ASSISTANT_DAILY_LIMIT`,
  `ASSISTANT_PROXY_SECRET` (required in production, on BOTH api and web),
  `ASSISTANT_LOG_TRANSCRIPTS`. The api container also needs the OpenRouter key
  file mounted (`OLLAMA_ENV_FILE`, as the worker).

## 9. Site paths Snapper may link to

`/`, `/features`, `/how-it-works`, `/pricing`, `/download`, `/support`,
`/docs`, `/docs/getting-started`, `/docs/capturing-receipts`,
`/docs/reviewing-corrections`, `/docs/confidence-and-flags`,
`/docs/ledger-and-posted`, `/docs/data-retention`, `/legal/privacy`,
`/legal/terms`, `/legal/security`, `/register`, `/sign-in`. Anchors on those
pages are fine.

## 10. The widget (apps/web)

Port of Tunas's `src/scripts/chat/` (index, dock, panel, stream, md, store,
config) as a client island mounted from the marketing layout, restyled in the
site kit (`src/design/site/README.md`: Geist, `--s-*` tokens, white cards,
blue gradient, both themes). Keep, from Tunas:

- hidden until `status` says ok (cached 10 min in sessionStorage);
- panel code loads on hover / focus / click / ~4 s idle; the mascot (three.js)
  after ~2.5 s idle via dynamic import — **three never reaches the first-load
  chunk**;
- poster first, canvas cross-faded in after its first frame; the single canvas
  flies from the launcher to the panel header (FLIP, 600 ms) and is never
  re-parented;
- the clear-spot check that moves the launcher off page controls;
- streaming markdown without innerHTML, chips, CTA cards, sources, page-aware
  starters and a teaser bubble ("G'day — got a receipt question?") with a wave;
- `role=dialog`, `role=log aria-live=polite aria-busy`, Esc, focus return,
  mobile 100dvh bottom sheet following `visualViewport`, sessionStorage history
  (`snap-assistant:v1`);
- reduced motion / saveData / no WebGL → poster + CSS-only motion.

Snapper-specific interactions: clicking the mascot plays `snap()` (the shutter
clicks, a white flash, a hop); three quick pokes → a dizzy spin with happy eyes;
the mascot follows the pointer; it nods while you type, scans while it thinks,
talks while the answer streams, beams on a CTA click, droops on an error.

## 11. The mascot (apps/web/src/components/assistant/mascot)

Procedural three.js, no GLB, like Tunas. API identical to Tunas's
`mascot/index.ts` plus one gesture:

```ts
type MascotMood = 'idle' | 'attentive' | 'listening' | 'thinking' | 'talking' | 'happy' | 'sorry';
interface Mascot {
  readonly canvas: HTMLCanvasElement;
  setMood(m: MascotMood): void;
  lookAt(x: number | null, y: number | null): void;
  nod(): void; hop(): void; wave(): void;
  snap(): void;                         // shutter click + flash (Snapper only)
  dizzy(): void;                        // the three-poke reaction
  speak(level: number): void;
  setActive(on: boolean): void;
  resize(cssPx: number): void;
  dispose(): void;
}
createMascot(opts: { size: number; reducedMotion: boolean }): Promise<Mascot | null>;
MASCOT_FRAME  // where the body/eyes/top/ground sit in the square canvas
```

Design:

- **Body:** the app icon as a soft glossy cushion — a superellipsoid, square
  from the front with rounded corners (≈ the icon's 15/64 corner radius), ~0.62
  deep, a touch fuller at the bottom. Vertex gradient `#1E9DE0` (crown) →
  `#1878D8` → `#0F5BB5` → `#0A4A96` (underside). MeshPhysical, clearcoat 1,
  low clearcoat roughness, a cyan fresnel rim (`#7FD8FF`).
- **Face:** a paper docket plate on the front — off-white `#FFFDF8`, faint
  printed rules, a torn zig-zag bottom edge — carrying the eyes (glossy ink
  `#0B111A` with two catch-lights, blinks, ^ ^ happy, sad lids), a painted mouth
  (smile, open, "o", frown) and soft blush.
- **Viewfinder brackets:** the icon's four white rounded L-brackets, floating
  just outside the body's corners. Idle: they breathe. Attentive: they spread.
  Thinking: they snap inward and lock, and a cyan scan line (`#3FC6EE` glow)
  sweeps down the face plate. Happy: they pop out and spin a quarter-turn back.
  Sorry: they droop.
- **Shutter button:** a small cylinder on top with a silver ring; it presses on
  `snap()` with a quick white flash sprite.
- **Arms:** two blue capsule nubs. Contact shadow below. Thinking: small dots in
  `#1878D8` / `#1CA8DB` / white orbit on a tilted ring. Happy: cyan/white
  sparkles.
- Lights and render settings as Tunas (ACES, FOV ~22°, key/rim/hemisphere, a
  small baked PMREM studio), adjusted so the blue reads rich, not dark.
- Fallback poster: `public/assistant/snapper-poster.webp` (+ 160 px and a happy
  pose), rendered from the same stage by `apps/web/scripts/render-snapper-poster.py` (Playwright; run by the orchestrator against a dev server).

## 12. File ownership (2026-10-20 build)

| Owner | Files |
|---|---|
| Server core | `apps/server/src/assistant/**` except `knowledge/` and `eval/`; one line in `apps/server/src/app.module.ts`; `apps/server/src/config.ts` (additive env schema only); `deploy/docker-compose.yml` (api: key file mount + env; web: secret env) and `deploy/.env.example` |
| Knowledge | `apps/server/src/assistant/knowledge/**`, `apps/server/src/assistant/eval/**` |
| Widget | `apps/web/src/app/api/assistant/**`, `apps/web/src/components/assistant/**` except `mascot/`, `apps/web/src/app/(marketing)/layout.tsx` (swap the widget), deleting `apps/web/src/components/chat/**` |
| Mascot | `apps/web/src/components/assistant/mascot/**`, `apps/web/src/app/(dev)/**` (a dev-only preview route that 404s in production), `apps/web/scripts/render-snapper-poster.py`, `apps/web/public/assistant/**` |

Nobody runs dev servers, builds, tsc, vitest, installs or git writes; the
orchestrator runs every gate once and reviews every diff.
