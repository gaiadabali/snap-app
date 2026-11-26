import { MailError } from "../model";
import type { Addr, Draft, MessageDetail } from "../model";

// Pure composing helpers: reply / forward drafts and the JMAP Email body for a draft.

/** The proxy refuses more than this many envelope recipients (BUILD.md §4.3). */
export const MAX_RECIPIENTS = 10;

function dedupe(list: Addr[], exclude: string[]): Addr[] {
  const seen = new Set(exclude.map((e) => e.trim().toLowerCase()));
  const out: Addr[] = [];
  for (const a of list) {
    const key = a.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function label(a: Addr): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

function prefixed(subject: string, prefix: "Re" | "Fwd"): string {
  const pattern = prefix === "Re" ? /^\s*re\s*:\s*/i : /^\s*(fwd?|fw)\s*:\s*/i;
  return pattern.test(subject) ? subject : `${prefix}: ${subject}`;
}

function quote(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** `draftFrom`: reply, reply-all or forward. `own` is the mailbox's address, left out of recipients. */
export function draftFrom(msg: MessageDetail, mode: "reply" | "replyAll" | "forward", own: string | null): Draft {
  const exclude = own ? [own] : [];
  const body = msg.text ?? msg.preview;
  const when = msg.receivedAt;
  const who = msg.from ? label(msg.from) : "an unknown sender";

  if (mode === "forward") {
    const lines = [
      "",
      "",
      "---------- Forwarded message ----------",
      `From: ${msg.from ? label(msg.from) : ""}`,
      `Date: ${when}`,
      `Subject: ${msg.subject}`,
      `To: ${msg.to.map(label).join(", ")}`,
      "",
      body,
    ];
    const draft: Draft = {
      to: [],
      subject: prefixed(msg.subject, "Fwd"),
      text: lines.join("\n"),
      attachments: msg.attachments.filter((a) => !a.inline),
    };
    return draft;
  }

  const primary = msg.replyTo.length > 0 ? msg.replyTo : msg.from ? [msg.from] : [];
  const to =
    mode === "replyAll" ? dedupe([...primary, ...msg.to], exclude) : dedupe(primary, exclude);
  const cc = mode === "replyAll" ? dedupe(msg.cc, [...exclude, ...to.map((a) => a.email)]) : [];
  const draft: Draft = {
    to,
    subject: prefixed(msg.subject, "Re"),
    text: `\n\nOn ${when}, ${who} wrote:\n${quote(body)}\n`,
    references: msg.messageId ? [...msg.references, msg.messageId] : [...msg.references],
  };
  if (cc.length > 0) draft.cc = cc;
  if (msg.messageId) draft.inReplyTo = msg.messageId;
  return draft;
}

/** Every distinct envelope recipient of a draft (To, Cc and Bcc). */
export function recipientsOf(d: Draft): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of [...d.to, ...(d.cc ?? []), ...(d.bcc ?? [])]) {
    const email = a.email.trim();
    const key = email.toLowerCase();
    if (email === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Checks a draft is sendable before any request is made. */
export function assertSendable(d: Draft): string[] {
  const rcpt = recipientsOf(d);
  if (rcpt.length === 0) throw new MailError("rejected", "add at least one recipient");
  if (rcpt.length > MAX_RECIPIENTS) {
    throw new MailError("too_many_recipients", `at most ${MAX_RECIPIENTS} recipients per message`);
  }
  return rcpt;
}

function jmapAddr(a: Addr): { name?: string; email: string } {
  return a.name ? { name: a.name, email: a.email.trim() } : { email: a.email.trim() };
}

/**
 * JMAP `Email/set` create object for a draft. `from` is exactly the mailbox
 * address (the proxy refuses anything else, BUILD.md §4.3).
 */
export function draftEmailObject(
  d: Draft,
  address: string,
  draftsMailboxId: string,
  asDraft: boolean,
): Record<string, unknown> {
  const email: Record<string, unknown> = {
    mailboxIds: { [draftsMailboxId]: true },
    keywords: asDraft ? { $draft: true, $seen: true } : { $seen: true },
    from: [{ email: address }],
    to: d.to.map(jmapAddr),
    subject: d.subject,
    bodyValues: { body: { value: d.text } },
    textBody: [{ partId: "body", type: "text/plain" }],
  };
  if (d.cc && d.cc.length > 0) email["cc"] = d.cc.map(jmapAddr);
  if (d.bcc && d.bcc.length > 0) email["bcc"] = d.bcc.map(jmapAddr);
  if (d.inReplyTo) email["inReplyTo"] = [d.inReplyTo];
  if (d.references && d.references.length > 0) email["references"] = d.references;
  if (d.attachments && d.attachments.length > 0) {
    email["attachments"] = d.attachments.map((a) => ({
      blobId: a.blobId,
      type: a.type,
      name: a.name,
      disposition: "attachment",
    }));
  }
  return email;
}
