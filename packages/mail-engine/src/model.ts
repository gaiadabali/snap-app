// Public types of the mail engine (spambank/BUILD.md §5.7).
// Types only, plus MailError. No DOM, React Native or Node imports.

export type FolderKey = "inbox" | "spam" | "junk" | "sent" | "drafts" | "trash";

export interface Addr {
  name?: string;
  email: string;
}

export interface MailSession {
  token: string;
  expiresAt: string;
  sessionUrl: string;
  helpersBase: string;
  address: string;
}

export interface Folder {
  key: FolderKey;
  mailboxId: string;
  unread: number;
  total: number;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  folder: FolderKey | null;
  from: Addr | null;
  to: Addr[];
  subject: string;
  preview: string;
  receivedAt: string;
  unread: boolean;
  flagged: boolean;
  hasAttachment: boolean;
  bulk: boolean;
}

export interface Attachment {
  blobId: string;
  name: string;
  type: string;
  size: number;
  inline: boolean;
}

export interface MessageDetail extends MessageSummary {
  cc: Addr[];
  replyTo: Addr[];
  messageId: string | null;
  references: string[];
  /** Plain-text body. HTML is only available through `safeHtml()`. */
  text: string | null;
  hasHtml: boolean;
  attachments: Attachment[];
  unsubscribe: "one_click" | "mailto" | "link" | null;
}

export interface SafeHtml {
  html: string;
  remoteImagesBlocked: number;
  inlineImagesDropped: number;
  truncated: boolean;
}

export interface Draft {
  draftId?: string;
  to: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject: string;
  text: string;
  attachments?: Attachment[];
  inReplyTo?: string;
  references?: string[];
}

export type UnsubscribeResult =
  | { status: "done"; method: "one_click" | "mailto" }
  | { status: "open_link"; method: "link"; url: string }
  | { status: "failed" | "unavailable" };

export interface MailSummary {
  address: string;
  counters: { bulkFiled30d: number; marketersUnsubscribed: number; autoRepliesSent30d: number };
  banner: { title: string; body: string; ctaLabel: string; ctaUrl: string } | null;
}

export type FileInput =
  | { kind: "blob"; blob: Blob; name: string }
  | { kind: "uri"; uri: string; name: string; type: string }; // React Native

export type MailErrorCode =
  | "unauthorized"
  | "not_enabled"
  | "unavailable"
  | "rate_limited"
  | "network"
  | "too_many_recipients"
  | "daily_send_cap"
  | "rejected";

export class MailError extends Error {
  code: MailErrorCode;
  /** HTTP status when the error came from a response. */
  status?: number;

  constructor(code: MailErrorCode, message?: string, options?: { status?: number; cause?: unknown }) {
    super(message ?? code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MailError";
    this.code = code;
    if (options?.status !== undefined) this.status = options.status;
  }
}

export interface Page {
  position?: number;
  limit?: number;
}

export interface MailClient {
  folders(): Promise<Folder[]>;
  list(folder: FolderKey, page?: Page): Promise<{ items: MessageSummary[]; total: number }>;
  search(text: string, page?: Page): Promise<{ items: MessageSummary[]; total: number }>;
  get(id: string): Promise<MessageDetail>;
  safeHtml(id: string): Promise<SafeHtml>;
  setRead(ids: string[], read: boolean): Promise<void>;
  setFlagged(ids: string[], flagged: boolean): Promise<void>;
  /** Into spam: +$Junk; out of spam: +$NotJunk. */
  move(ids: string[], to: FolderKey): Promise<void>;
  /** To trash; a message already in trash is destroyed. */
  remove(ids: string[]): Promise<void>;
  upload(file: FileInput): Promise<Attachment>;
  download(att: Attachment): Promise<Blob | { uri: string }>;
  draftFrom(msg: MessageDetail, mode: "reply" | "replyAll" | "forward"): Draft;
  saveDraft(d: Draft): Promise<{ draftId: string }>;
  /** Explicit envelope; moves Drafts -> Sent on success. */
  send(d: Draft): Promise<{ emailId: string }>;
  unsubscribe(id: string, opts?: { moveToJunk?: boolean }): Promise<UnsubscribeResult>;
  summary(locale?: string): Promise<MailSummary>;
  onChange(listener: (what: { folders: boolean; messages: boolean }) => void): () => void;
  close(): void;
}

export interface MailClientOptions {
  /** The app's own backend mints the mail token. */
  getSession: () => Promise<MailSession>;
  fetch?: typeof fetch;
  /** auto: SSE where fetch can stream, else poll. */
  push?: "auto" | "sse" | "poll";
  /** Poll interval, default 30 000 ms. */
  pollMs?: number;
  /** React Native: stream a download to a file and return its uri. */
  downloadToUri?: (url: string, headers: Record<string, string>, name: string) => Promise<{ uri: string }>;
}

export const FOLDER_KEYS: readonly FolderKey[] = ["inbox", "spam", "junk", "sent", "drafts", "trash"];
