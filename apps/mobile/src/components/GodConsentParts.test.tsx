import type { GodConsentState } from '@snap/api-contract';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  GodNoticeBox,
  GodConsentPromptView,
  GodWithdrawView,
  GuardianConsentBox,
  GUARDIAN_LINK_TEXT,
  ADULT_LINK_TEXT,
  NoticeText,
} from './GodConsentParts';

// The two sentences exactly as the founder approved them (god/TASKS.md 9.1.d). The phone shows the
// server's copy of them; this pins that the rendering keeps every word.
const ADULT =
  'I have read and accept the GOD Group Privacy Notice. I understand that my activity in YourTal, SnapApps and Free Tax Returns is combined into one profile, and that businesses receive reports about groups of people, never about me.';
const GUARDIAN =
  "I am this teen's parent or guardian. I have read the GOD Group Privacy Notice for teens and agree that my teen's activity may be combined and used, in groups of 20 or more, to give businesses insight about young people. No business receives anything about my teen individually.";

const NOTICE: GodConsentState['notice'] = {
  id: 'god-group-notice',
  version: '1.1',
  effective: '2026-11-27',
  url: 'https://god.gaiada.com/privacy-notice/',
  teenUrl: 'https://god.gaiada.com/privacy-notice/#teens',
  adultText: ADULT,
  guardianText: GUARDIAN,
};

const noop = () => {};

/** The text between the tags, read character by character (no regex sanitising of markup). */
function textOf(markup: string): string {
  let out = '';
  let inTag = false;
  for (const ch of markup) {
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

/** Markup to the words a person reads. */
const words = (markup: string) => textOf(markup).split('&#x27;').join("'").replace(/\s+/g, ' ');

describe('NoticeText', () => {
  it('keeps the adult sentence verbatim', () => {
    const markup = renderToStaticMarkup(createElement(NoticeText, { text: ADULT, linkText: ADULT_LINK_TEXT, href: NOTICE.url }));
    expect(words(markup)).toBe(ADULT);
  });

  it('keeps the parent sentence verbatim', () => {
    const markup = renderToStaticMarkup(
      createElement(NoticeText, { text: GUARDIAN, linkText: GUARDIAN_LINK_TEXT, href: NOTICE.teenUrl }),
    );
    expect(words(markup)).toBe(GUARDIAN);
  });
});

describe('GodNoticeBox (a new sign-up)', () => {
  it('is a checkbox with the sentence beside it', () => {
    const markup = renderToStaticMarkup(createElement(GodNoticeBox, { notice: NOTICE, ticked: false, onToggle: noop }));
    expect(markup).toContain('role="checkbox"');
    expect(words(markup)).toContain(ADULT);
  });
});

describe('GodConsentPromptView (an existing account, next sign-in)', () => {
  const view = (over: Partial<Parameters<typeof GodConsentPromptView>[0]> = {}) =>
    words(
      renderToStaticMarkup(
        createElement(GodConsentPromptView, {
          notice: NOTICE,
          ticked: false,
          busy: false,
          error: null,
          onToggle: noop,
          onAccept: noop,
          onNotNow: noop,
          ...over,
        }),
      ),
    );

  it('offers Accept and Not now, shows the box unticked, and says use continues either way', () => {
    const t = view();
    expect(t).toContain(ADULT);
    expect(t).toContain('Accept');
    expect(t).toContain('Not now');
    expect(t).toContain('You can keep using SnapApps either way.');
    expect(t).toContain('We only ask again if the notice changes.');
  });

  it('shows a refusal', () => {
    expect(view({ error: 'Could not save your answer. Try again.' })).toContain('Could not save your answer. Try again.');
  });
});

describe('GodWithdrawView', () => {
  it('offers the exact request, and confirms it once recorded', () => {
    const idle = words(renderToStaticMarkup(createElement(GodWithdrawView, { busy: false, error: null, done: false, onWithdraw: noop })));
    expect(idle).toContain('Stop combining my data with GOD');
    const done = words(renderToStaticMarkup(createElement(GodWithdrawView, { busy: false, error: null, done: true, onWithdraw: noop })));
    expect(done).not.toContain('Stop combining my data with GOD');
    expect(done).toContain('We have recorded your request');
  });
});

describe('GuardianConsentBox (a parent, for a teen)', () => {
  it('shows the parent sentence verbatim, unticked, and says the teen is never asked', () => {
    const t = words(
      renderToStaticMarkup(
        createElement(GuardianConsentBox, { notice: NOTICE, teenName: 'Tia', accepted: false, busy: false, onAnswer: noop }),
      ),
    );
    expect(t).toContain(GUARDIAN);
    expect(t).toContain('Accept for Tia');
    expect(t).toContain('Tia is never asked.');
  });

  it('once accepted, offers withdrawal only', () => {
    const t = words(
      renderToStaticMarkup(
        createElement(GuardianConsentBox, { notice: NOTICE, teenName: 'Tia', accepted: true, busy: false, onAnswer: noop }),
      ),
    );
    expect(t).toContain('Stop combining Tia’s data with GOD');
    expect(t).not.toContain(GUARDIAN);
  });
});
