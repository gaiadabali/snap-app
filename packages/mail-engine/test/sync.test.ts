import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "sync-mail-engine.mjs");
const SRC = join(import.meta.dirname, "..", "src");

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mail-engine-sync-"));
  made.push(d);
  return d;
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1).replace(/\\/g, "/"))
    .sort();
}

// Each run shells out to git (status, rev-parse), which is slow on a large Windows checkout.
describe("scripts/sync-mail-engine.mjs", { timeout: 90_000 }, () => {
  it("copies src/ byte for byte with LF endings and prints the snap-app commit", () => {
    const target = join(tmp(), "mail-engine");
    const res = run(target);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^Synced \d+ files from snap-app@[0-9a-f]{40}(-dirty)? to /);
    expect(files(target)).toEqual(files(SRC));
    for (const f of files(SRC)) {
      const original = readFileSync(join(SRC, f), "utf8").replace(/\r\n/g, "\n");
      expect(readFileSync(join(target, f), "utf8")).toBe(original);
    }
    expect(readFileSync(join(target, "index.ts"), "utf8")).not.toContain("\r");
  });

  it("mirrors: files removed from src/ disappear from the target", () => {
    const target = tmp();
    mkdirSync(join(target, "old"), { recursive: true });
    writeFileSync(join(target, "old", "stale.ts"), "export {}\n");
    writeFileSync(join(target, "stale-root.ts"), "export {}\n");
    expect(run(target).status).toBe(0);
    expect(files(target)).toEqual(files(SRC));
  });

  it("--check passes on a fresh copy, tolerates CRLF, and fails on any difference", () => {
    const target = tmp();
    run(target);
    expect(run("--check", target).status).toBe(0);

    const index = join(target, "index.ts");
    writeFileSync(index, readFileSync(index, "utf8").replace(/\n/g, "\r\n"));
    expect(run("--check", target).status).toBe(0);

    writeFileSync(index, readFileSync(index, "utf8") + "// drift\n");
    const drift = run("--check", target);
    expect(drift.status).toBe(1);
    expect(drift.stderr).toContain("differs: index.ts");

    rmSync(join(target, "model.ts"));
    writeFileSync(join(target, "extra.ts"), "export {}\n");
    const more = run("--check", target);
    expect(more.stderr).toContain("missing: model.ts");
    expect(more.stderr).toContain("extra: extra.ts");
  });

  it("needs a target, and refuses to write into the source", () => {
    expect(run().status).toBe(2);
    expect(run(SRC).status).toBe(2);
  });

  it("is runnable with plain node (no dependencies)", () => {
    expect(execFileSync(process.execPath, ["--check", SCRIPT], { encoding: "utf8" })).toBe("");
  });
});
