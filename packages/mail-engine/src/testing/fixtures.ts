import type { Addr, FolderKey } from "../model";

/** The address the in-memory mailbox belongs to. */
export const MEMORY_ADDRESS = "geewizduck@yourtal.gaiada.com";

export interface MemoryAttachmentSeed {
  name: string;
  type: string;
  size: number;
  inline?: boolean;
}

/** One fixture message. Everything but `id`, `folder` and `subject` has a default. */
export interface MemoryMessageSeed {
  id: string;
  folder: FolderKey;
  from: Addr | null;
  to: Addr[];
  cc?: Addr[];
  replyTo?: Addr[];
  subject: string;
  /** Plain-text body (null for an HTML-only message). */
  text: string | null;
  /** Already-sanitised HTML, as the server's safe-html route would return it. */
  html?: string | null;
  receivedAt: string;
  unread: boolean;
  flagged: boolean;
  attachments?: MemoryAttachmentSeed[];
  unsubscribe: "one_click" | "mailto" | "link" | null;
  bulk: boolean;
  remoteImagesBlocked?: number;
  messageId?: string | null;
  references?: string[];
  threadId?: string;
}

const me: Addr = { name: "Gee Wizduck", email: MEMORY_ADDRESS };

function at(hoursAgo: number): string {
  // A fixed clock keeps fixtures and snapshots stable between runs. It is in the past
  // so anything created "now" (sent, delivered) sorts above the fixtures.
  const base = Date.UTC(2026, 10, 20, 3, 0, 0);
  return new Date(base - hoursAgo * 3_600_000).toISOString();
}

const PDF = "application/pdf";

/** ~20 messages covering plain text, HTML, attachments, List-Unsubscribe, spam and bulk mail. */
export function defaultSeeds(): MemoryMessageSeed[] {
  return [
    // ---- Inbox
    {
      id: "m1", folder: "inbox", from: { name: "Maria Santos", email: "maria@example.com" }, to: [me],
      subject: "Lunch on Friday?", receivedAt: at(1), unread: true, flagged: false,
      text: "Hi Gee,\n\nAre you free for lunch on Friday? The new place near the market has a good set menu.\n\nMaria",
      unsubscribe: null, bulk: false, messageId: "<m1@example.com>",
    },
    {
      id: "m2", folder: "inbox", from: { name: "Anika Rao", email: "anika@rao-accounting.example" }, to: [me],
      replyTo: [{ name: "Rao Accounting", email: "reception@rao-accounting.example" }],
      subject: "Your 2025-26 tax return checklist", receivedAt: at(3), unread: true, flagged: false,
      text: "Hello,\n\nPlease find the checklist attached. Send the bank statements when you have them.\n\nAnika",
      html: "<div><p>Hello,</p><p>Please find the <b>checklist</b> attached. Send the bank statements when you have them.</p><p>Anika</p></div>",
      attachments: [{ name: "checklist.pdf", type: PDF, size: 183422 }],
      unsubscribe: null, bulk: false, messageId: "<m2@rao-accounting.example>",
    },
    {
      id: "m3", folder: "inbox", from: { name: "Harbour Bank", email: "statements@harbourbank.example" }, to: [me],
      subject: "Your November statement is ready", receivedAt: at(6), unread: true, flagged: false,
      text: "Your statement for November is attached.",
      attachments: [{ name: "statement-nov.pdf", type: PDF, size: 90211 }, { name: "statement-nov.csv", type: "text/csv", size: 4120 }],
      unsubscribe: null, bulk: false, messageId: "<m3@harbourbank.example>",
    },
    {
      id: "m4", folder: "inbox", from: { name: "Dev Patel", email: "dev@example.org" }, to: [me, { email: "lee@example.org" }],
      cc: [{ name: "Priya", email: "priya@example.org" }],
      subject: "Re: Quote for the deck", receivedAt: at(26), unread: false, flagged: false,
      text: "Thanks, that works for us. Can you send the final numbers by Monday?\n\n> On Wed, Gee wrote:\n> Quote attached.",
      messageId: "<m4@example.org>", references: ["<m0@example.org>"], threadId: "t4",
      unsubscribe: null, bulk: false,
    },
    {
      id: "m5", folder: "inbox", from: { name: "Gaia Digital", email: "billing@gaiada.example" }, to: [me],
      subject: "Invoice 2026-114", receivedAt: at(30), unread: false, flagged: true,
      text: "Invoice 2026-114 is attached. Payment is due in 14 days.",
      attachments: [{ name: "invoice-2026-114.pdf", type: PDF, size: 55120 }],
      unsubscribe: null, bulk: false, messageId: "<m5@gaiada.example>",
    },
    {
      id: "m6", folder: "inbox", from: { name: "YourTal", email: "hello@yourtal.example" }, to: [me],
      subject: "Welcome to your Spambank inbox", receivedAt: at(48), unread: false, flagged: false,
      text: null,
      html: "<div><h2>Welcome</h2><p>This inbox files marketing mail for you.</p><p><a href=\"https://yourtal.example/help\" target=\"_blank\" rel=\"noopener noreferrer\">How it works</a></p></div>",
      unsubscribe: null, bulk: false, messageId: "<m6@yourtal.example>",
    },
    {
      id: "m7", folder: "inbox", from: { name: "Sam Wirawan", email: "sam@example.com" }, to: [me],
      subject: "Photos from Bali", receivedAt: at(52), unread: false, flagged: false,
      text: "Here are the photos from the weekend. The sunset one is my favourite.",
      attachments: [
        { name: "sunset.jpg", type: "image/jpeg", size: 2_400_000 },
        { name: "beach.jpg", type: "image/jpeg", size: 1_900_000 },
        { name: "logo.png", type: "image/png", size: 1200, inline: true },
      ],
      unsubscribe: null, bulk: false, messageId: "<m7@example.com>",
    },
    {
      id: "m8", folder: "inbox", from: { name: "Shire Council", email: "rates@shire.example" }, to: [me],
      subject: "Rates notice 2026-27", receivedAt: at(120), unread: false, flagged: false,
      text: "Your rates notice for 2026-27 is available in the portal.",
      unsubscribe: null, bulk: false, messageId: "<m8@shire.example>",
    },
    // ---- Spam (spam filter)
    {
      id: "m9", folder: "spam", from: { email: "prize@winner-now.example" }, to: [me],
      subject: "You have WON $1,000,000!!!", receivedAt: at(5), unread: true, flagged: false,
      text: "Click here to claim your prize now.", unsubscribe: null, bulk: false,
    },
    {
      id: "m10", folder: "spam", from: { name: "Account Security", email: "security@acc0unt-verify.example" }, to: [me],
      subject: "Urgent: verify your account", receivedAt: at(9), unread: true, flagged: false,
      text: null,
      html: "<div><p>Your account will be closed. Verify now.</p><p><a href=\"https://acc0unt-verify.example/login\" target=\"_blank\" rel=\"noopener noreferrer\">Verify</a></p></div>",
      remoteImagesBlocked: 3, unsubscribe: null, bulk: false,
    },
    {
      id: "m11", folder: "spam", from: { email: "deals@pharma-cheap.example" }, to: [me],
      subject: "Cheap meds, no prescription", receivedAt: at(40), unread: false, flagged: false,
      text: "Order today.", unsubscribe: null, bulk: false,
    },
    // ---- Junk (bulk mail filed by the Sieve rule)
    {
      id: "m12", folder: "junk", from: { name: "Weekly Deals", email: "news@dealsweekly.example" }, to: [me],
      subject: "This week: 40% off everything", receivedAt: at(2), unread: true, flagged: false,
      text: null,
      html: "<div><h1>40% off</h1><p>Shop the sale before Sunday.</p><table><tr><td>Shoes</td><td>$49</td></tr></table></div>",
      remoteImagesBlocked: 4, unsubscribe: "one_click", bulk: true,
    },
    {
      id: "m13", folder: "junk", from: { name: "Coffee Co", email: "hello@coffeeco.example" }, to: [me],
      subject: "Your cart is waiting", receivedAt: at(8), unread: true, flagged: false,
      text: "You left something in your cart.", unsubscribe: "mailto", bulk: true,
    },
    {
      id: "m14", folder: "junk", from: { name: "GrowthLab", email: "events@growthlab.example" }, to: [me],
      subject: "Webinar: grow your business in 2027", receivedAt: at(22), unread: false, flagged: false,
      text: "Join our free webinar.", unsubscribe: "link", bulk: true,
    },
    {
      id: "m15", folder: "junk", from: { name: "Coffee Co Receipts", email: "receipts@coffeeco.example" }, to: [me],
      subject: "Receipt: flat white", receivedAt: at(70), unread: false, flagged: false,
      text: "Thanks for your order. Total $5.20.", unsubscribe: null, bulk: true,
    },
    // ---- Sent
    {
      id: "m16", folder: "sent", from: me, to: [{ name: "Maria Santos", email: "maria@example.com" }],
      subject: "Re: Lunch on Friday?", receivedAt: at(0.5), unread: false, flagged: false,
      text: "Friday works. 12:30?", unsubscribe: null, bulk: false, messageId: "<m16@yourtal.gaiada.com>",
    },
    {
      id: "m17", folder: "sent", from: me, to: [{ name: "Dev Patel", email: "dev@example.org" }],
      subject: "Quote for the deck", receivedAt: at(50), unread: false, flagged: false,
      text: "Quote attached.", attachments: [{ name: "quote.pdf", type: PDF, size: 70200 }],
      unsubscribe: null, bulk: false, messageId: "<m0@example.org>",
    },
    // ---- Drafts
    {
      id: "m18", folder: "drafts", from: me, to: [{ name: "Sam Wirawan", email: "sam@example.com" }],
      subject: "Notes for Monday", receivedAt: at(4), unread: false, flagged: false,
      text: "Agenda:\n1. Budget\n2. Launch date", unsubscribe: null, bulk: false,
    },
    // ---- Trash
    {
      id: "m19", folder: "trash", from: { name: "Old Magazine", email: "subs@oldmag.example" }, to: [me],
      subject: "Your subscription has ended", receivedAt: at(200), unread: false, flagged: false,
      text: "Your subscription has ended.", unsubscribe: null, bulk: false,
    },
    {
      id: "m20", folder: "trash", from: { name: "Maria Santos", email: "maria@example.com" }, to: [me],
      subject: "Test message", receivedAt: at(300), unread: false, flagged: false,
      text: "Just testing.", unsubscribe: null, bulk: false,
    },
  ];
}
