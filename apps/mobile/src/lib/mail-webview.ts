/**
 * How a message's HTML is shown on Android, as plain data and rules so they can be tested
 * without a WebView (spambank/BUILD.md B6, §4.4).
 *
 * The HTML is sanitised by the server (one sanitiser to harden), remote images are already
 * stripped, and the engine's `toSandboxDocument()` puts a Content-Security-Policy meta first
 * (`default-src 'none'; img-src data:; ...`). This is the second wall, the WebView itself:
 *
 *   - JavaScript OFF. Nothing in a mail can run, whatever the sanitiser missed. This also
 *     means the page cannot report its own height, so the reader gives the WebView the whole
 *     body area and lets it scroll by itself.
 *   - No storage, no cookies, no cache, no file or content access, no mixed content, no
 *     geolocation, no extra windows: it is a read-only page with nothing to remember.
 *   - It never navigates. The document is loaded once from a string; every later navigation
 *     (a tapped link, a redirect) is cancelled here, and a plain web or mail link is opened
 *     OUTSIDE the app, in the phone's browser or mail app.
 */
export const SANDBOX_WEBVIEW_PROPS = {
  javaScriptEnabled: false,
  domStorageEnabled: false,
  javaScriptCanOpenWindowsAutomatically: false,
  setSupportMultipleWindows: false,
  allowFileAccess: false,
  allowFileAccessFromFileURLs: false,
  allowUniversalAccessFromFileURLs: false,
  allowContentAccess: false,
  mixedContentMode: 'never' as const,
  geolocationEnabled: false,
  cacheEnabled: false,
  incognito: true,
  thirdPartyCookiesEnabled: false,
  sharedCookiesEnabled: false,
  allowsLinkPreview: false,
  // Everything is "whitelisted" ON PURPOSE. react-native-webview hands a URL that fails the
  // whitelist straight to Linking.openURL (any scheme the phone can open: intent:, market:,
  // tel:, file:) and never asks our handler. Whitelisting all lets `decideNavigation` below be
  // the one place that decides: it cancels every navigation and opens only http(s) and mailto.
  originWhitelist: ['*'] as string[],
  // The page has no scripts, so an overscroll glow or a zoom control has nothing to do with it.
  overScrollMode: 'never' as const,
  textZoom: 100,
};

/** The base URL given with the inline document, so it has an opaque origin and no one else's. */
export const SANDBOX_BASE_URL = 'about:blank';

/**
 * Decides what to do with a navigation the WebView is about to make. `allow` is only ever
 * true for the inline document itself; `openOutside` is set when the person tapped a link
 * that may go to the browser or mail app.
 */
export function decideNavigation(url: string): { allow: boolean; openOutside: string | null } {
  if (url === 'about:blank' || url === 'about:srcdoc') return { allow: true, openOutside: null };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allow: false, openOutside: null };
  }
  const outside = parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
  return { allow: false, openOutside: outside ? url : null };
}
