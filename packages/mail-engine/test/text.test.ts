import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, snippetToText } from "../src/text";

describe("text helpers", () => {
  it("htmlToText drops tags, keeps text, collapses whitespace", () => {
    expect(htmlToText("<div><p>Hello <b>world</b></p>\n<p>Bye</p></div>")).toBe("Hello world Bye");
    expect(htmlToText("a < b and c > d")).toBe("a d"); // an unclosed '<' swallows to the next '>': never leaves a tag behind
    expect(htmlToText("")).toBe("");
  });

  it("htmlToText never leaves a tag opener behind, even for broken markup", () => {
    for (const hostile of ["<scr<script>ipt>alert(1)", "<<script>script>", "<img src=x onerror=alert(1)", "<<<<<<<<<<"]) {
      expect(htmlToText(hostile)).not.toContain("<");
    }
  });

  it("htmlToText is linear on pathological input", () => {
    const start = Date.now();
    htmlToText("<".repeat(200_000));
    htmlToText("<a ".repeat(100_000));
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("decodeEntities decodes once, not twice", () => {
    expect(decodeEntities("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;")).toBe("a <b> & \"c\" 'd'");
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("&unknown; &")).toBe("&unknown; &");
  });

  it("snippetToText removes only the highlight tags and decodes the rest", () => {
    expect(snippetToText("see the <mark>checklist</mark> &amp; the &lt;script&gt;")).toBe("see the checklist & the <script>");
    expect(snippetToText("<mark>a</mark><mark>b</mark>")).toBe("ab");
  });
});
