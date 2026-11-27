import { describe, expect, it } from 'vitest';

import { SANDBOX_BASE_URL, SANDBOX_WEBVIEW_PROPS, decideNavigation } from './mail-webview';

describe('the message WebView settings', () => {
  it('runs no JavaScript', () => {
    expect(SANDBOX_WEBVIEW_PROPS.javaScriptEnabled).toBe(false);
    expect(SANDBOX_WEBVIEW_PROPS.javaScriptCanOpenWindowsAutomatically).toBe(false);
  });

  it('remembers nothing and reaches no files', () => {
    const p = SANDBOX_WEBVIEW_PROPS;
    expect(p.domStorageEnabled).toBe(false);
    expect(p.cacheEnabled).toBe(false);
    expect(p.incognito).toBe(true);
    expect(p.thirdPartyCookiesEnabled).toBe(false);
    expect(p.sharedCookiesEnabled).toBe(false);
    expect(p.allowFileAccess).toBe(false);
    expect(p.allowFileAccessFromFileURLs).toBe(false);
    expect(p.allowUniversalAccessFromFileURLs).toBe(false);
    expect(p.allowContentAccess).toBe(false);
    expect(p.mixedContentMode).toBe('never');
    expect(p.geolocationEnabled).toBe(false);
    expect(p.setSupportMultipleWindows).toBe(false);
  });

  it('whitelists everything so our own rule, not the library, decides where a link goes', () => {
    // A URL outside the whitelist is opened by the library with no question asked, for any scheme.
    expect(SANDBOX_WEBVIEW_PROPS.originWhitelist).toEqual(['*']);
    expect(SANDBOX_BASE_URL).toBe('about:blank');
  });
});

describe('decideNavigation', () => {
  it('lets the inline document load', () => {
    expect(decideNavigation('about:blank')).toEqual({ allow: true, openOutside: null });
  });

  it('cancels a tapped web link and hands it to the browser', () => {
    expect(decideNavigation('https://example.com/offer?id=1')).toEqual({ allow: false, openOutside: 'https://example.com/offer?id=1' });
    expect(decideNavigation('http://example.com')).toEqual({ allow: false, openOutside: 'http://example.com' });
  });

  it('hands a mail link to the mail app', () => {
    expect(decideNavigation('mailto:hello@example.com')).toEqual({ allow: false, openOutside: 'mailto:hello@example.com' });
  });

  it('cancels everything else without opening it anywhere', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///data/data/au.com.snapapps.app/databases/x',
      'content://com.android.contacts/contacts',
      'intent://scan/#Intent;scheme=zxing;end',
      'market://details?id=evil',
      'tel:+61400000000',
      'not a url',
      '',
    ]) {
      expect(decideNavigation(url)).toEqual({ allow: false, openOutside: null });
    }
  });
});
