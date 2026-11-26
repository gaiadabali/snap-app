// @snap/mail-engine: the shared Spambank mail engine (spambank/BUILD.md §5.7).
//
// Source of truth is SnapApp (packages/mail-engine/src). YourTal and Free Tax
// Returns carry byte-for-byte copies; change the engine only here.
//
// Rules for everything under src/: no DOM or React Native imports at module load,
// no Node built-ins, no ".js" import suffixes (Metro resolves them literally).

export type {
  Addr,
  Attachment,
  Draft,
  FileInput,
  Folder,
  FolderKey,
  MailClient,
  MailClientOptions,
  MailErrorCode,
  MailSession,
  MailSummary,
  MessageDetail,
  MessageSummary,
  SafeHtml,
  UnsubscribeResult,
} from "./model";
export { MailError } from "./model";
export { createMailClient } from "./client";
export { IFRAME_SANDBOX, MAIL_CSP, toSandboxDocument } from "./html";
