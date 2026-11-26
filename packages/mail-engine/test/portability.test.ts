import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The engine runs in Next (web) and in Expo React Native (Hermes): no DOM, no
// Node-only APIs, and Metro resolves relative imports literally (BUILD.md §5.7).

const SRC = join(import.meta.dirname, "..", "src");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? sources(full) : e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [full] : [];
  });
}

const files = sources(SRC).map((f) => ({ path: relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

/** Module specifiers in `import ... from "x"`, `export ... from "x"` and `import("x")`. */
function specifiers(text: string): string[] {
  const out: string[] = [];
  // `[^"'`]` keeps a match from running through a string list such as ["id", "from", ...].
  for (const m of text.matchAll(/^(?:import|export)\s[^"'`]*?\sfrom\s+["']([^"']+)["']/gm)) out.push(m[1] as string);
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1] as string);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) out.push(m[1] as string);
  return out;
}

/** Comments removed, so rules do not trip on prose. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("engine source is portable", () => {
  it("finds the engine's files", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(["index.ts", "react.ts", "testing.ts", "client.ts"]));
  });

  it("imports only relative modules (and `react`, in react.ts)", () => {
    for (const f of files) {
      for (const spec of specifiers(f.text)) {
        const ok = spec.startsWith("./") || spec.startsWith("../") || (spec === "react" && f.path === "react.ts");
        expect(ok, `${f.path} imports "${spec}"`).toBe(true);
      }
    }
  });

  it("has no extension on relative imports (Metro resolves them literally)", () => {
    for (const f of files) {
      for (const spec of specifiers(f.text).filter((s) => s.startsWith("."))) {
        expect(spec, `${f.path} imports "${spec}"`).not.toMatch(/\.(js|jsx|ts|tsx|mjs|cjs)$/);
      }
    }
  });

  it("uses no Node built-ins, DOM globals or React Native modules", () => {
    const banned: [RegExp, string][] = [
      [/\bnode:/, "node: import"],
      [/\brequire\s*\(/, "require()"],
      [/\bprocess\./, "process"],
      [/\bBuffer\b/, "Buffer"],
      [/\b__dirname\b|\b__filename\b/, "__dirname"],
      [/\bwindow\b/, "window"],
      [/\bdocument\./, "document"],
      [/\blocalStorage\b|\bsessionStorage\b/, "web storage"],
      [/\bnavigator\b/, "navigator"],
      [/\bEventSource\b/, "EventSource (cannot send an Authorization header)"],
      [/["'](react-native|react-dom|expo)/, "platform package"],
    ];
    for (const f of files) {
      const body = code(f.text);
      for (const [re, what] of banned) expect(re.test(body), `${f.path} uses ${what}`).toBe(false);
    }
  });

  it("only react.ts imports React", () => {
    for (const f of files) {
      const importsReact = specifiers(f.text).includes("react");
      expect(importsReact, f.path).toBe(f.path === "react.ts");
    }
  });

  it("never puts a token in a URL", () => {
    for (const f of files) {
      expect(/[?&](token|access_token|auth)=/i.test(code(f.text)), f.path).toBe(false);
    }
  });
});
