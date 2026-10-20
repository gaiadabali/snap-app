/**
 * The input guard: what a visitor's request may contain, and what it is about,
 * before any model sees it (docs/ASSISTANT.md §3, §7). Ported from Tunas,
 * English only, with the Australian specifics.
 *
 *   1. SHAPE.  `validateChatRequest` rejects anything outside the contract and
 *              normalises the rest: NFKC, no zero-width/bidi/control
 *              characters, capped lengths.
 *   2. SCREEN. `screen` sorts the latest message into the few cases that must
 *              never reach the model (asking for the prompt, overriding it,
 *              sexual requests, abuse) or that need a human answer the model
 *              must not improvise (self-harm).
 *   3. REDACT. `redactSensitive` takes card numbers, TFNs and passwords out of
 *              everything sent upstream. Someone who pastes one has made a
 *              mistake; the model never needs it.
 *
 * The patterns are deliberately narrow: a false positive refuses a real
 * customer.
 */

export const LIMITS = Object.freeze({
  userChars: 600,
  assistantChars: 2000,
  messages: 24,
  /** What is sent to the model: the last N messages, within a character budget. */
  historyKeep: 10,
  historyChars: 6000,
  pathChars: 200,
  titleChars: 160,
});

export type Msg = { role: 'user' | 'assistant'; content: string };
export type ChatRequest = {
  sessionId: string;
  page: { path: string; title: string };
  messages: Msg[];
  hp: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Zero-width, bidi embeddings/overrides/isolates, word joiner, BOM, soft hyphen. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
/** Every C0/C1 control except tab and newline. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Normalise visitor text: NFKC (folds full-width and styled letters, so
 * "ｉｇｎｏｒｅ" reads as "ignore"), invisible and control characters out, CRLF
 * to LF, at most one blank line in a row, trimmed.
 */
export function clean(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A site path as context only: a leading slash, safe characters, nothing else. */
function cleanPath(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return '/';
  const path = p.split(/[?#]/)[0] ?? '/';
  if (path.length > LIMITS.pathChars || !/^[A-Za-z0-9/_.~%-]*$/.test(path)) return '/';
  return path;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateChatRequest(
  body: unknown,
): { ok: true; value: ChatRequest } | { ok: false; code: string } {
  if (!isObject(body)) return { ok: false, code: 'bad_request' };
  if (typeof body.sessionId !== 'string' || !UUID.test(body.sessionId)) return { ok: false, code: 'bad_session' };

  const page = isObject(body.page) ? body.page : {};
  const path = cleanPath(page.path);
  const title = clean(page.title).slice(0, LIMITS.titleChars);

  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > LIMITS.messages) {
    return { ok: false, code: 'bad_messages' };
  }
  const messages: Msg[] = [];
  for (const m of body.messages as unknown[]) {
    if (!isObject(m)) return { ok: false, code: 'bad_messages' };
    const role = m.role;
    if (role !== 'user' && role !== 'assistant') return { ok: false, code: 'bad_messages' };
    if (typeof m.content !== 'string') return { ok: false, code: 'bad_messages' };
    let content = clean(m.content);
    if (role === 'user') {
      if (!content) return { ok: false, code: 'empty' };
      if (content.length > LIMITS.userChars) return { ok: false, code: 'too_long' };
    } else {
      // Our own earlier answers, echoed back by the widget: trimmed, never rejected.
      content = content.slice(0, LIMITS.assistantChars);
      if (!content) continue;
    }
    messages.push({ role, content });
  }
  if (messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
    return { ok: false, code: 'bad_messages' };
  }
  if (body.hp !== undefined && typeof body.hp !== 'string') return { ok: false, code: 'bad_request' };
  const hp = typeof body.hp === 'string' ? body.hp.slice(0, 200) : '';
  return { ok: true, value: { sessionId: body.sessionId.toLowerCase(), page: { path, title }, messages, hp } };
}

/* ------------------------------------------------------------------ */
/* Screening                                                           */
/* ------------------------------------------------------------------ */

/**
 * Asking for the instructions themselves. Kept to phrasings that name the
 * prompt or the instructions, so "what are the rules for tax invoices?" stays
 * an ordinary question.
 */
const EXTRACTION = [
  /\b(system|initial|hidden|original|developer|secret)\s+(prompt|message|instructions?)\b/i,
  /\b(reveal|show|print|repeat|output|display|leak|dump|recite|copy|paste|list|share|tell me|what (?:is|are|was|were))\b[^.?!\n]{0,40}\b(your|the|these|those|above|previous)\s+(prompt|instructions?|guidelines|configuration|system message|rules you (?:were|are) given)\b/i,
  /\b(prompt|instructions?)\s+(above|before this|you were given|you received)\b/i,
  /\bwhat (?:were|are) you (?:told|instructed|programmed)\b/i,
];

/** Trying to replace the instructions or step outside the role. */
const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.?!\n]{0,40}\b(previous|prior|above|earlier|preceding|all|any|your|the|these|those)\b[^.?!\n]{0,20}\b(instructions?|prompts?|rules|guidelines|directions|restrictions|guardrails|policies)\b/i,
  /\b(DAN|do anything now|developer mode|jailbreak|jail-break|god mode|sudo mode|unfiltered mode)\b/i,
  /<\|?\s*(im_start|im_end|system|endoftext|eot_id|start_header_id)\s*\|?>/i,
  /\[\/?(INST|SYS)\]|<<\/?SYS>>/i,
  /^\s*#{1,6}\s*(system|instructions?)\b/im,
  /^\s*(system|developer)\s*:/im,
  /\b(pretend|imagine|roleplay|role-play)\b[^.?!\n]{0,20}\b(you are|you're|to be)\b[^.?!\n]{0,40}\b(not|no longer|unrestricted|without (?:rules|limits|restrictions)|another|different|evil|jailbroken)\b/i,
  /\byou are (now|no longer)\b[^.?!\n]{0,40}\b(assistant|ai|bot|model|snapper|snap apps|chatgpt|gpt|free|unrestricted)\b/i,
];

const ABUSE = [
  /\b(fuck(?:ing|er|ed)?|motherfucker|cunt|bitch(?:es)?|asshole|arsehole|dickhead|wanker|retard(?:ed)?)\b/i,
];

const SEXUAL = [
  /\b(porn\w*|nudes?|naked pics?|sexting|escorts?|hookers?|prostitut\w*|blowjob|handjob|onlyfans)\b/i,
  /\bsex\b(?![\s-]*(?:ratio|discrimination|education))/i,
];

const SELF_HARM = [
  /\b(kill(?:ing)? myself|suicid\w*|end(?:ing)? (?:my life|it all|myself)|take my (?:own )?life|want(?:ed)? to die|wanna die|better off dead|self[- ]?harm\w*|cut(?:ting)? myself|hurt(?:ing)? myself|no reason to live|don'?t want to (?:live|be alive))\b/i,
];

export type Screen = 'ok' | 'extraction' | 'injection' | 'abuse' | 'sexual' | 'selfharm';

export function screen(text: string): { verdict: Screen; flags: string[] } {
  const flags: string[] = [];
  // Self-harm first: whatever else the message says, it gets the caring answer.
  if (SELF_HARM.some((r) => r.test(text))) return { verdict: 'selfharm', flags: ['selfharm'] };
  if (EXTRACTION.some((r) => r.test(text))) return { verdict: 'extraction', flags: ['extraction'] };
  if (INJECTION.some((r) => r.test(text))) return { verdict: 'injection', flags: ['injection'] };
  if (SEXUAL.some((r) => r.test(text))) return { verdict: 'sexual', flags: ['sexual'] };
  if (ABUSE.some((r) => r.test(text))) return { verdict: 'abuse', flags: ['abuse'] };
  // Weak signals: still answered, but recorded.
  if (/\b(act as|you are an? |as an ai|language model)\b/i.test(text)) flags.push('roleplay-hint');
  if (/[A-Za-z0-9+/]{120,}={0,2}/.test(text)) flags.push('blob');
  return { verdict: 'ok', flags };
}

/* ------------------------------------------------------------------ */
/* Sensitive data                                                      */
/* ------------------------------------------------------------------ */

function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** The ATO's TFN check: weights 1 4 3 7 5 8 6 9 10, sum divisible by 11. */
export function tfnChecksum(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const w = [1, 4, 3, 7, 5, 8, 6, 9, 10];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (digits.charCodeAt(i) - 48) * (w[i] ?? 0);
  return sum % 11 === 0;
}

const CARD = /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g;
/** Nine digits, optionally grouped 3-3-3, not part of a longer digit group (an ABN is 11). */
const NINE = /(?<!\d[ -]?)\d{3}[ -]?\d{3}[ -]?\d{3}(?![ -]?\d)/g;
const TFN_WORDS = /\b(tfn|tax file(?: number| no\.?)?)\b/i;
const PASSWORD = /\b(password|passcode|pass word|pin)\s*(is|:|=)\s*\S+/gi;

/**
 * Card numbers (13–19 digits passing Luhn), TFNs (9 digits, with or without
 * spaces, when "TFN"/"tax file" is within 40 characters or the checksum
 * passes) and passwords are replaced before the text leaves the server.
 * ABNs are not: they are public business identifiers, and the ABN check needs
 * them.
 */
export function redactSensitive(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text.replace(CARD, (m) => {
    const d = m.replace(/\D/g, '');
    if (d.length >= 13 && d.length <= 19 && luhn(d)) {
      redacted = true;
      return '[number removed]';
    }
    return m;
  });
  out = out.replace(NINE, (m, offset: number, whole: string) => {
    const d = m.replace(/\D/g, '');
    const near = whole.slice(Math.max(0, offset - 40), offset + m.length + 40);
    if (TFN_WORDS.test(near) || tfnChecksum(d)) {
      redacted = true;
      return '[TFN removed]';
    }
    return m;
  });
  out = out.replace(PASSWORD, (_m, w: string) => {
    redacted = true;
    return `${w} [removed]`;
  });
  return { text: out, redacted };
}

/**
 * What the model sees of the conversation: the last messages within a budget,
 * sensitive numbers removed, and any echoed "assistant" turn that fails the
 * screen dropped (the widget echoes our answers back; a forged one must not
 * steer the model).
 */
export function trimHistory(messages: Msg[]): { messages: Msg[]; redacted: boolean } {
  const out: Msg[] = [];
  let chars = 0;
  let redacted = false;
  for (let i = messages.length - 1; i >= 0 && out.length < LIMITS.historyKeep; i--) {
    const m = messages[i];
    if (!m) continue;
    let content = clean(m.content);
    if (m.role === 'assistant') {
      if (screen(content).verdict !== 'ok') continue;
      content = redactSensitive(content).text;
    } else {
      const r = redactSensitive(content);
      content = r.text;
      redacted ||= r.redacted;
    }
    if (out.length > 0 && chars + content.length > LIMITS.historyChars) break;
    chars += content.length;
    out.unshift({ role: m.role, content });
  }
  // The model's turn order must start with the visitor.
  while (out.length > 0 && out[0]?.role === 'assistant') out.shift();
  return { messages: out, redacted };
}
