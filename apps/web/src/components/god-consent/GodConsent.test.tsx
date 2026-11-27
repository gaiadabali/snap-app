import type { GodConsentState } from '@snap/api-contract';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GodConsentPromptView, GodWithdrawView } from './GodConsent';
import { GuardianConsent } from './GuardianConsent';
import { ADULT_LINK_TEXT, GUARDIAN_LINK_TEXT, NoticeSentence } from './NoticeSentence';

// The two sentences exactly as the founder approved them (god/TASKS.md 9.1.d).
const ADULT =
  'I have read and accept the GOD Group Privacy Notice. I understand that my activity in YourTal, SnapApp and Free Tax Returns is combined into one profile, and that businesses receive reports about groups of people, never about me.';
const GUARDIAN =
  "I am this teen's parent or guardian. I have read the GOD Group Privacy Notice for teens and agree that my teen's activity may be combined and used, in groups of 20 or more, to give businesses insight about young people. No business receives anything about my teen individually.";

const NOTICE: GodConsentState['notice'] = {
  id: 'god-group-notice',
  version: '1.0',
  effective: '2026-11-27',
  url: 'https://god.gaiada.com/privacy-notice/',
  teenUrl: 'https://god.gaiada.com/privacy-notice/#teens',
  adultText: ADULT,
  guardianText: GUARDIAN,
};

/** Markup to the words a person reads. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'");

describe('NoticeSentence', () => {
  it('keeps the sentence verbatim and links only the notice name', () => {
    const markup = renderToStaticMarkup(<NoticeSentence text={ADULT} linkText={ADULT_LINK_TEXT} href={NOTICE.url} />);
    expect(words(markup)).toBe(ADULT);
    expect(markup).toContain(`href="${NOTICE.url}"`);
    expect(markup).toMatch(/<a [^>]*>GOD Group Privacy Notice<\/a>\. I understand/);
  });

  it('links the teen notice to the teens section, over its longer name', () => {
    const markup = renderToStaticMarkup(
      <NoticeSentence text={GUARDIAN} linkText={GUARDIAN_LINK_TEXT} href={NOTICE.teenUrl} />,
    );
    expect(words(markup)).toBe(GUARDIAN);
    expect(markup).toContain('href="https://god.gaiada.com/privacy-notice/#teens"');
    expect(markup).toMatch(/<a [^>]*>GOD Group Privacy Notice for teens<\/a> and agree/);
  });
});

describe('GodConsentPromptView (existing accounts, next sign-in)', () => {
  const view = (over: Partial<Parameters<typeof GodConsentPromptView>[0]> = {}) =>
    renderToStaticMarkup(
      <GodConsentPromptView
        notice={NOTICE}
        ticked={false}
        busy={false}
        error={null}
        onTick={() => {}}
        onAccept={() => {}}
        onNotNow={() => {}}
        {...over}
      />,
    );

  it('shows the box unticked, the sentence verbatim, Accept (disabled until ticked) and Not now', () => {
    const markup = view();
    expect(words(markup)).toContain(ADULT);
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Accept<\/button>/);
    expect(markup).toContain('Not now');
  });

  it('enables Accept once ticked', () => {
    const markup = view({ ticked: true });
    expect(markup).toContain('checked=""');
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Accept<\/button>/);
  });

  it('says normal use continues either way', () => {
    expect(words(view())).toContain('You can keep using SnapApp either way.');
  });
});

describe('GodWithdrawView', () => {
  it('offers the exact request, and confirms it once recorded', () => {
    const idle = renderToStaticMarkup(<GodWithdrawView busy={false} error={null} done={false} onWithdraw={() => {}} />);
    expect(idle).toContain('Stop combining my data with GOD');
    const done = renderToStaticMarkup(<GodWithdrawView busy={false} error={null} done onWithdraw={() => {}} />);
    expect(done).not.toContain('Stop combining my data with GOD');
    expect(words(done)).toContain('We have recorded your request');
  });
});

describe('GuardianConsent (a parent, for a teen)', () => {
  it('shows the parent sentence verbatim, linked to the teens section, unticked, with Accept disabled', () => {
    const markup = renderToStaticMarkup(
      <GuardianConsent notice={NOTICE} teenName="Tia" accepted={false} busy={false} onAnswer={() => {}} />,
    );
    expect(words(markup)).toContain(GUARDIAN);
    expect(markup).toContain('#teens');
    expect(markup).not.toContain('checked=""');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Accept for Tia<\/button>/);
    expect(words(markup)).toContain('Tia is never asked.');
  });

  it('once accepted, offers withdrawal and no tick box', () => {
    const markup = renderToStaticMarkup(
      <GuardianConsent notice={NOTICE} teenName="Tia" accepted busy={false} onAnswer={() => {}} />,
    );
    expect(markup).not.toContain('type="checkbox"');
    expect(words(markup)).toContain('Stop combining Tia’s data with GOD');
  });
});
