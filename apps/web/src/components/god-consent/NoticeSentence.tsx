import type { ReactNode } from 'react';

/**
 * One of the two GOD notice sentences, verbatim, with the notice's name as the
 * link (god/TASKS.md 9.1.d). The wording is the server's (`GET /v1/god-consent`),
 * never typed again here, so the web and the phone cannot drift apart. The
 * link opens in a new tab: someone ticking the box must not lose their form.
 */
export function NoticeSentence({ text, linkText, href }: { text: string; linkText: string; href: string }): ReactNode {
  const at = text.indexOf(linkText);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
        {linkText}
      </a>
      {text.slice(at + linkText.length)}
    </>
  );
}

export const ADULT_LINK_TEXT = 'GOD Group Privacy Notice';
export const GUARDIAN_LINK_TEXT = 'GOD Group Privacy Notice for teens';
