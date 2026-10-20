/**
 * What the visitor is after, from their words alone, in well under a
 * millisecond (docs/ASSISTANT.md §3). Ported from Tunas. It decides three
 * things:
 *   - whether a message is small talk the server answers itself (a greeting,
 *     thanks): instant, and no model call;
 *   - the call to action an answer carries when the model names none;
 *   - the label in the logs and in the `meta` event.
 * It never decides WHAT is said about Snap Apps: that is the model's job,
 * inside the harness's rules.
 */

export type Intent =
  | 'greeting'
  | 'thanks'
  | 'complaint'
  | 'account'
  | 'human'
  | 'app'
  | 'start'
  | 'pricing'
  | 'contact'
  | 'question';

export type Cta = 'app' | 'start' | 'human';

const SHORT = 6;

const GREETING =
  /^(?:hi+|hello+|hey+|hiya|howdy|yo|g'?day(?: mate)?|good (?:morning|afternoon|evening|day)|morning|afternoon|evening)(?:\s+(?:there|snapper|snap apps|team|all|mate|guys))?[\s!.,?~]*$/i;

const THANKS =
  /^(?:(?:ok(?:ay)?|great|perfect|cool|nice|sweet|awesome|good stuff|legend|beauty|no worries)[\s,!.]*)?(?:thanks?(?: you)?(?: so much| a lot| very much| heaps| mate)?|thank u|thx|ty|ta|cheers(?: mate)?|bye|goodbye|see ya|see you|catch ya|that'?s all)(?:[\s,!.]+(?:snapper|mate))?(?:[\s,!.]+(?:that(?:'s| is)? (?:helps?|helped|helpful|great|perfect|all)|appreciate it|much appreciated))?[\s!.~]*$/i;

const HUMAN =
  /\b(human|real person|a person|someone (?:real|from)|your team|the team|support team|agent|representative|speak (?:to|with)|talk (?:to|with)|call me|contact me|phone number|your number|email address|your email|customer service|get in touch)\b/i;

const COMPLAINT =
  /\b(complain\w*|refund|scam\w*|fraud|disappointed|unhappy|not happy|terrible|awful|worst|angry|furious|unacceptable|rip[- ]?off|ripped off|charged twice|double charged|doesn'?t work|does not work|broken|crash(?:es|ed|ing)?|bug)\b/i;

const ACCOUNT =
  // Account ADMINISTRATION only. "my receipts", "my data", "my credits" used
  // to match too, so "how long are my receipts kept?" was classed as an
  // account problem and answered with a contact-a-human card (eval, 2026-10-20).
  /\b(my (?:account|login|password|email address|balance)|log ?in|sign ?in (?:problem|issue)|can'?t (?:log|sign) in|delete (?:my|the) account|close my account|cancel (?:my|the) account|billing|payment (?:issue|problem|failed))\b/i;

const APP =
  /\b(download|install|apk|android|google play|play store|app store|iphone|ios|ipad|get the app|mobile app|phone app|on my phone)\b/i;

const START =
  /\b(sign ?up|signup|register|create (?:an |my )?account|get started|start (?:using|now|free)|try (?:it|snap apps|for free|free)|free trial|join)\b/i;

const PRICING =
  /\b(price[sd]?|pricing|cost[s]?|how much (?:is|does|do|are) (?:it|snap apps|the app|a scan|scans|credits?)|fee[s]?|credits?|packs?|per scan|afford|expensive|cheap|subscription|plans?)\b/i;

const CONTACT = /\b(contact|support|help ?desk|where are you|address|office|located|location|who (?:makes|built|runs) (?:it|this|snap apps))\b/i;

export function classify(text: string): Intent {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words <= SHORT && GREETING.test(t)) return 'greeting';
  if (words <= SHORT + 2 && THANKS.test(t)) return 'thanks';
  if (COMPLAINT.test(t)) return 'complaint';
  if (ACCOUNT.test(t)) return 'account';
  if (HUMAN.test(t)) return 'human';
  if (APP.test(t)) return 'app';
  if (START.test(t)) return 'start';
  if (PRICING.test(t)) return 'pricing';
  if (CONTACT.test(t)) return 'contact';
  return 'question';
}

/** The call to action an intent carries when the model names none. */
export function defaultCta(intent: string): Cta | undefined {
  switch (intent) {
    case 'app':
      return 'app';
    case 'start':
    case 'pricing':
      return 'start';
    case 'human':
    case 'complaint':
    case 'account':
      return 'human';
    default:
      return undefined;
  }
}
