import { describe, expect, it } from "vitest";
import { IFRAME_SANDBOX, MAIL_CSP, toSandboxDocument } from "../src/html";
import type { SafeHtml } from "../src/model";

const safe = (html: string): SafeHtml => ({ html, remoteImagesBlocked: 0, inlineImagesDropped: 0, truncated: false });

describe("toSandboxDocument", () => {
  it("puts the CSP meta first, before any mail content", () => {
    const doc = toSandboxDocument(safe("<p>Hello</p>"));
    expect(doc.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${MAIL_CSP}">`)).toBe(true);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>Hello</p>"));
    expect(doc).toContain("<body><p>Hello</p></body>");
  });

  it("carries no script of its own", () => {
    const doc = toSandboxDocument(safe("<p>x</p>"), { dark: true });
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("uses the contract's exact CSP and iframe sandbox", () => {
    expect(MAIL_CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:");
    expect(IFRAME_SANDBOX).toBe("allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    expect(IFRAME_SANDBOX).not.toContain("allow-scripts");
  });

  it("blocks every remote fetch: only data: images, inline styles", () => {
    expect(MAIL_CSP).toContain("default-src 'none'");
    expect(MAIL_CSP).not.toMatch(/https?:/);
    expect(MAIL_CSP).toContain("img-src data:");
  });

  it("follows the dark option", () => {
    const light = toSandboxDocument(safe("x"));
    const dark = toSandboxDocument(safe("x"), { dark: true });
    expect(light).toContain("color-scheme:light");
    expect(dark).toContain("color-scheme:dark");
    expect(dark).not.toBe(light);
  });

  it("keeps the sanitised html untouched", () => {
    const html = '<table><tr><td style="color:red">a &amp; b</td></tr></table><img src="data:image/png;base64,AAAA">';
    expect(toSandboxDocument(safe(html))).toContain(html);
  });
});
