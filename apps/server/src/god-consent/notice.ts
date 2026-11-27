import type { GodConsentState } from '@snap/api-contract';

/**
 * The GOD Group Privacy Notice, as SnapApp, YourTal and Free Tax Returns all
 * show it (god/TASKS.md 9.1.d). The id, version, date, URL and the two tick-box
 * sentences are ONE contract across the three apps: change them there first.
 *
 * The server owns the wording so the web and the phone cannot drift apart. Bump
 * `version` when the notice changes: everyone with an older answer is asked
 * again (an existing person, "Not now" allowed; a teen's parent).
 */
export const GOD_NOTICE: GodConsentState['notice'] = {
  id: 'god-group-notice',
  version: '1.1',
  effective: '2026-11-27',
  url: 'https://god.gaiada.com/privacy-notice/',
  teenUrl: 'https://god.gaiada.com/privacy-notice/#teens',
  adultText:
    'I have read and accept the GOD Group Privacy Notice. I understand that my activity in YourTal, SnapApps and Free Tax Returns is combined into one profile, and that businesses receive reports about groups of people, never about me.',
  guardianText:
    "I am this teen's parent or guardian. I have read the GOD Group Privacy Notice for teens and agree that my teen's activity may be combined and used, in groups of 20 or more, to give businesses insight about young people. No business receives anything about my teen individually.",
};
