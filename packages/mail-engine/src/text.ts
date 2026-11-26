// Small text helpers. They produce PLAIN TEXT for previews and search; nothing here
// sanitises HTML for display (that is the server's safe-html route, BUILD.md B6).
// Written as single linear passes rather than regex replaces: tag-stripping regexes
// are both a ReDoS risk on hostile input and a classic way to leave `<script` behind.

/** The text of an HTML string: every `<...>` run becomes a space, whitespace is collapsed. */
export function htmlToText(html: string): string {
  let out = "";
  let inTag = false;
  for (let i = 0; i < html.length; i++) {
    const ch = html.charAt(i);
    if (ch === "<") {
      inTag = true;
      out += " ";
    } else if (ch === ">" && inTag) {
      inTag = false;
    } else if (!inTag) {
      out += ch;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', amp: "&", "#39": "'", apos: "'" };

/** Decodes the five XML entities (plus &#39;) in ONE pass, so `&amp;lt;` becomes `&lt;`, not `<`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(lt|gt|quot|amp|#39|apos);/g, (_m, name: string) => ENTITIES[name] ?? _m);
}

/**
 * A search snippet from the server: the matching words are wrapped in `<mark>` and the
 * rest is HTML-escaped. Returns the plain text. Only the known `<mark>` tags are removed.
 */
export function snippetToText(snippet: string): string {
  return decodeEntities(snippet.split("<mark>").join("").split("</mark>").join(""));
}
