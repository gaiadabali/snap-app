/**
 * Snapper, the Snap Apps assistant: every word the widget shows, the page-aware
 * starters, and the three call-to-action cards (docs/ASSISTANT.md §3, §10).
 *
 * No prices and no free-scan counts are typed here (docs/WEB.md §4.0, the
 * `free-scans` test): money comes from the server, which gets it from code.
 * Voice: plain, Australian, a little dry, no emoji, no exclamation marks.
 */

export const NAME = 'Snapper';

export type Cta = 'app' | 'start' | 'human';
export type IconName = 'chat' | 'tag' | 'phone' | 'receipt' | 'person' | 'spark' | 'shield' | 'camera' | 'offline';

export interface Starter {
  /** `ask` sends the label as a question; `human` shows the Help centre card without calling the model. */
  kind: 'ask' | 'human';
  label: string;
  icon: IconName;
}

export const S = {
  sub: 'Snap Apps assistant',
  pill: 'Ask Snapper',
  launcher: 'Ask Snapper, the Snap Apps assistant',
  greet: "G'day, I'm Snapper.",
  intro: 'Ask me how capture works, what GST means on a docket, what a scan costs, or how to get the app.',
  placeholder: 'Ask about Snap Apps…',
  composerLabel: 'Your question for Snapper',
  send: 'Send',
  stop: 'Stop',
  note: 'General information, not tax advice.',
  menu: 'More options',
  minimise: 'Close chat',
  newChat: 'New chat',
  human: 'Talk to a person',
  logLabel: 'Conversation with Snapper',
  you: 'You',
  checking: 'Looking at {t}',
  thinking: 'Thinking',
  sources: 'Sources',
  newMsgs: 'New message',
  retry: 'Try again',
  stopped: 'Stopped.',
  teaser: "G'day — got a receipt question?",
  teaserClose: 'Dismiss',
  teaserLabel: 'Snapper says hello',
  eRate: 'That is a lot of questions in a short time. Give it a minute and try again.',
  eBusy: 'I have had a very busy day and need a breather. Try again later, or the Help centre has the answers.',
  eDown: 'I cannot reach my brain right now. Try again in a moment.',
  eNet: 'The connection dropped. Check it and try again.',
  eBad: 'I could not make sense of that one. Try putting it another way.',
  eBlocked: 'I cannot help with that one. Ask me about Snap Apps and I will give it a go.',
} as const;

export interface CtaCard {
  title: string;
  text: string;
  label: string;
  href: string;
}

/** docs/ASSISTANT.md §3: `app` is the Android download, `start` is sign-up, `human` is support. */
export const CTAS: Record<Cta, CtaCard> = {
  app: {
    title: 'Get the Android app',
    text: 'Snap Apps installs on Android today. The iPhone app is in development.',
    label: 'Get the Android app',
    href: '/download',
  },
  start: {
    title: 'Try it on a real receipt',
    text: 'Make an account and photograph a docket from this week.',
    label: 'Start free',
    href: '/register',
  },
  human: {
    title: 'Need a person?',
    text: 'The Help centre has the guides and the way to reach us.',
    label: 'Help centre',
    href: '/support',
  },
};

export const ERROR_TEXT: Record<string, string> = {
  rate_limited: S.eRate,
  busy: S.eBusy,
  unavailable: S.eDown,
  network: S.eNet,
  bad_request: S.eBad,
  blocked: S.eBlocked,
};

/** A question shown first on a page, by route. The first matching prefix wins. */
const PAGE_STARTERS: [prefix: string, label: string, icon: IconName][] = [
  ['/pricing', 'What does a scan cost?', 'tag'],
  ['/download', 'How do I install the APK?', 'phone'],
  ['/features', 'Does it work offline?', 'offline'],
  ['/how-it-works', 'How does it read a receipt?', 'camera'],
  ['/docs', 'How do I fix a wrong line?', 'receipt'],
  ['/support', 'How do I fix a wrong line?', 'receipt'],
  ['/legal', 'How long do you keep my receipts?', 'shield'],
  ['/register', 'What do I get when I sign up?', 'spark'],
  ['/sign-in', 'What do I get when I sign up?', 'spark'],
];

const GENERIC: Starter[] = [
  { kind: 'ask', label: 'What makes Snap Apps different?', icon: 'spark' },
  { kind: 'ask', label: 'Is a docket a valid tax invoice?', icon: 'receipt' },
  { kind: 'ask', label: 'Is there an iPhone app?', icon: 'phone' },
];

/** The welcome screen's four choices for a page: three questions (the page's own first), then a person. */
export function startersFor(path: string): Starter[] {
  const hit = PAGE_STARTERS.find(([p]) => path === p || path.startsWith(`${p}/`));
  const out: Starter[] = [];
  if (hit) out.push({ kind: 'ask', label: hit[1], icon: hit[2] });
  for (const g of GENERIC) {
    if (out.length >= 3) break;
    if (!out.some((s) => s.label === g.label)) out.push(g);
  }
  out.push({ kind: 'human', label: S.human, icon: 'person' });
  return out;
}
