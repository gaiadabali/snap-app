import type { SafeHtml } from "./model";

/**
 * Web iframe sandbox. There is deliberately NO `allow-scripts`: nothing in a mail
 * can run. `allow-same-origin` only lets the parent measure the frame height;
 * without scripts it gives the mail no capability (spambank/BUILD.md B6).
 */
export const IFRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

/** Second wall: even if the server sanitiser missed something, nothing can load. */
export const MAIL_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * Wraps server-sanitised HTML (`safeHtml()`) in a complete document for an
 * iframe `srcDoc` (web) or a JavaScript-off WebView (Android).
 *
 * The CSP meta is the first element in the document, before any mail content, so
 * it applies to all of it. The HTML itself is NOT re-sanitised here: sanitising is
 * the server's job (one sanitiser to harden, B6); this is the second wall.
 */
export function toSandboxDocument(safe: SafeHtml, opts?: { dark?: boolean }): string {
  const dark = opts?.dark === true;
  const fg = dark ? "#e8e8ea" : "#1b1b1f";
  const bg = dark ? "#16161a" : "#ffffff";
  const link = dark ? "#8ab4f8" : "#1a56c4";
  const css =
    `:root{color-scheme:${dark ? "dark" : "light"}}` +
    `html,body{margin:0;padding:0;background:${bg};color:${fg}}` +
    `body{padding:12px;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;` +
    `overflow-wrap:anywhere;word-break:break-word}` +
    `a{color:${link}}img{max-width:100%;height:auto}` +
    `table{max-width:100%}blockquote{margin:8px 0;padding-left:12px;border-left:3px solid ${dark ? "#444" : "#ccc"}}`;
  return (
    `<!doctype html><html><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="referrer" content="no-referrer">` +
    `<style>${css}</style>` +
    `</head><body>${safe.html}</body></html>`
  );
}
