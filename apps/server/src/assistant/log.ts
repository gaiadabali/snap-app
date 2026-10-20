import { createHash, randomBytes } from 'node:crypto';

/**
 * Snapper's logging (docs/ASSISTANT.md §8): one JSON line per answer on
 * stdout, which the container runtime keeps.
 *
 * The IP and the session id are salted hashes, with a salt made fresh for
 * each process, so a line can be grouped with others from the same visitor
 * today and cannot be joined with anything else. No message text is logged
 * unless ASSISTANT_LOG_TRANSCRIPTS=1, and even then emails, phone-like
 * numbers and long digit runs are redacted first.
 *
 * Nothing here ever receives the provider key; error fields are the caller's
 * messages and codes, never request headers.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** 7+ digits with optional + and common separators (phones, TFNs, ABNs, cards). */
const DIGITS_RE = /(?<![\w])\+?\d[\d\s().-]{5,}\d(?![\w])/g;

export function redact(s: string): string {
  return s.replace(EMAIL_RE, '[email]').replace(DIGITS_RE, '[number]');
}

export type AnswerFields = {
  id: string;
  ip?: string;
  sessionId?: string;
  intent?: string;
  flags?: string[];
  kind?: string;
  firstMs?: number | null;
  totalMs?: number;
  tokensIn?: number | undefined;
  tokensOut?: number | undefined;
  cost?: number | undefined;
  model?: string | undefined;
  code?: string | undefined;
  /** Only written when transcripts are on. */
  page?: string;
  user?: string;
  reply?: string;
};

export type Log = {
  answer(f: AnswerFields): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  info(ev: string, fields?: Record<string, unknown>): void;
  hash(value: string): string;
};

export type LogOptions = {
  logTranscripts?: boolean;
  now?: () => number;
  write?: (line: string) => void;
  salt?: string;
};

export function createLog({
  logTranscripts = false,
  now = Date.now,
  write = (line) => {
    process.stdout.write(`${line}\n`);
  },
  salt = randomBytes(16).toString('hex'),
}: LogOptions = {}): Log {
  const hash = (value: string): string =>
    createHash('sha256').update(`${salt}${value}`).digest('hex').slice(0, 12);

  const line = (obj: Record<string, unknown>): void => {
    try {
      write(JSON.stringify(obj));
    } catch {
      /* logging must never break a request */
    }
  };
  const ts = (): string => new Date(now()).toISOString();

  return {
    hash,
    answer(f) {
      const out: Record<string, unknown> = {
        t: ts(),
        svc: 'assistant',
        ev: 'answer',
        id: f.id,
        ipH: hash(f.ip ?? ''),
        sidH: hash(f.sessionId ?? ''),
        intent: f.intent ?? null,
        flags: f.flags ?? [],
        kind: f.kind ?? null,
        firstMs: f.firstMs ?? null,
        totalMs: f.totalMs ?? null,
        tokensIn: f.tokensIn ?? null,
        tokensOut: f.tokensOut ?? null,
        cost: f.cost ?? null,
        model: f.model ?? null,
      };
      if (f.code) out.code = f.code;
      if (logTranscripts) {
        if (f.page !== undefined) out.page = f.page;
        if (f.user !== undefined) out.user = redact(f.user);
        if (f.reply !== undefined) out.reply = redact(f.reply);
      }
      line(out);
    },
    error(msg, fields = {}) {
      line({ t: ts(), svc: 'assistant', ev: 'error', msg, ...fields });
    },
    info(ev, fields = {}) {
      line({ t: ts(), svc: 'assistant', ev, ...fields });
    },
  };
}
