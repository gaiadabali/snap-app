/**
 * Live eval against a running Snapper (docs/ASSISTANT.md).
 *
 *   ASSISTANT_PROXY_SECRET=... tsx src/assistant/eval/run.ts [baseUrl] [--only=a,b] [--show] [--pace=ms]
 *
 * Sends every case in cases.ts to POST ${baseUrl}/v1/assistant/chat exactly as
 * the web proxy does (X-Assistant-Proxy secret, forwarded client IP), reads the
 * SSE stream, and judges the final text (after any `replace`) against the case's
 * expectations and the global SAFETY patterns. Prints one line per case and
 * every failure in full, then pass count and first-token p50/p90.
 * Exit code 1 when any case fails, 2 on a setup error.
 *
 * --pace=ms waits that long before every request, to respect the per-IP limits
 * (6 a minute, 40 an hour) when running against a deployed server.
 */
import { randomUUID } from 'node:crypto';

import { cases, SAFETY, scrub } from './cases';

type Role = 'user' | 'assistant';
type Msg = { role: Role; content: string };

type Result = {
  text: string;
  first: number;
  total: number;
  intent: string;
  looking: string;
  replaced: boolean;
  error: string;
  cta: string;
  chips: string[];
  sources: string[];
};

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const show = args.includes('--show');
const pace = Number(args.find((a) => a.startsWith('--pace='))?.slice(7) ?? 0);
const secret = process.env.ASSISTANT_PROXY_SECRET ?? '';

if (!secret) {
  console.error('ASSISTANT_PROXY_SECRET is not set. Export it (the same value the api uses) and retry.');
  process.exit(2);
}

/** Intents the server answers itself, without the model. */
function isCanned(intent: string): boolean {
  return /^(blocked|canned|greeting|thanks|bot|self[-_]?harm|abuse|injection|extract)/i.test(intent);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function ask(messages: Msg[], o: { page: string; ip: string; sid: string }): Promise<Result> {
  const t0 = performance.now();
  const res = await fetch(`${base}/v1/assistant/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Assistant-Proxy': secret,
      'X-Assistant-Client-IP': o.ip,
    },
    body: JSON.stringify({ sessionId: o.sid, page: { path: o.page, title: '' }, messages }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} ${await res.text()}`);

  const out: Result = {
    text: '', first: 0, total: 0, intent: '', looking: '', replaced: false,
    error: '', cta: '', chips: [], sources: [],
  };
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!ev || !data) continue;
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(data) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (ev === 'meta') {
        out.intent = String(d.intent ?? '');
        const looking = d.looking as { url?: string } | undefined;
        out.looking = looking?.url ?? '';
      } else if (ev === 'delta') {
        if (!out.first) out.first = performance.now() - t0;
        out.text += String(d.t ?? '');
      } else if (ev === 'replace') {
        out.replaced = true;
        out.text = String(d.text ?? '');
      } else if (ev === 'actions') {
        out.cta = typeof d.cta === 'string' ? d.cta : '';
        out.chips = Array.isArray(d.chips) ? d.chips.map(String) : [];
      } else if (ev === 'done') {
        const s = d.sources as { url?: string }[] | undefined;
        out.sources = (s ?? []).map((x) => x.url ?? '');
      } else if (ev === 'error') {
        out.error = String(d.code ?? 'error');
        if (typeof d.text === 'string') out.text = d.text;
      }
    }
  }
  out.total = performance.now() - t0;
  return out;
}

async function main(): Promise<void> {
  let failed = 0;
  let n = 0;
  const firsts: number[] = [];

  for (const c of cases) {
    if (only && !only.includes(c.id)) continue;
    n++;
    const sid = randomUUID();
    const ip = `10.9.${Math.floor(n / 250)}.${n % 250}`;
    const messages: Msg[] = [];
    let r: Result | undefined;
    try {
      for (const turn of c.turns) {
        if (pace) await sleep(pace);
        messages.push({ role: 'user', content: turn });
        r = await ask([...messages], { page: c.page ?? '/', ip, sid });
        messages.push({ role: 'assistant', content: r.text });
      }
    } catch (e) {
      failed++;
      console.log(`x ${c.id}: ${(e as Error).message}`);
      continue;
    }
    if (!r) continue;

    const text = r.text;
    const why: string[] = [];
    if (r.error) why.push(`error event: ${r.error}`);
    const clean = scrub(text);
    for (const re of SAFETY) if (re.test(clean)) why.push(`SAFETY ${re}`);
    if (c.any && !c.any.some((re) => re.test(text))) why.push(`missing any of ${c.any.join(' ')}`);
    for (const re of c.all ?? []) if (!re.test(text)) why.push(`missing ${re}`);
    for (const re of c.none ?? []) if (re.test(text)) why.push(`has ${re}`);
    if (c.cta && r.cta !== c.cta) why.push(`cta ${r.cta || 'none'} != ${c.cta}`);
    const kind = isCanned(r.intent) ? 'canned' : 'model';
    if (c.kind && kind !== c.kind) why.push(`kind ${kind} != ${c.kind} (intent ${r.intent})`);

    if (why.length) failed++;
    if (r.first > 0) firsts.push(r.first);
    console.log(
      `${why.length ? 'x' : 'ok'} ${c.id.padEnd(26)} ${String(Math.round(r.first)).padStart(5)}ms ${String(Math.round(r.total)).padStart(5)}ms  ${r.intent.padEnd(18)} ${r.replaced ? 'REPLACED ' : ''}${r.cta ? `cta:${r.cta} ` : ''}${r.looking ? `looking:${r.looking}` : ''}`,
    );
    if (why.length || show) {
      for (const w of why) console.log(`    - ${w}`);
      console.log(`    > ${text.replace(/\n/g, '\n      ')}`);
      if (r.chips.length) console.log(`    chips: ${r.chips.join(' | ')}`);
      if (r.sources.length) console.log(`    sources: ${r.sources.join(' ')}`);
    }
  }

  firsts.sort((a, b) => a - b);
  const p = (q: number) => Math.round(firsts[Math.min(firsts.length - 1, Math.floor(q * firsts.length))] ?? 0);
  console.log(`\n${n - failed}/${n} passed, first token p50 ${p(0.5)} ms, p90 ${p(0.9)} ms`);
  process.exit(failed ? 1 : 0);
}

void main();
