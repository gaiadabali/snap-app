#!/usr/bin/env node
// Copies the mail engine source to a consumer repo (spambank/BUILD.md B4).
//
//   node scripts/sync-mail-engine.mjs <target-dir>            copy packages/mail-engine/src -> <target-dir>
//   node scripts/sync-mail-engine.mjs --check <target-dir>    exit 1 if <target-dir> differs from src/
//
// SnapApp is the source of truth. YourTal keeps its copy in packages/mail-engine/src
// and Free Tax Returns in src/mail-engine. The copy is byte-for-byte: text files are
// written with LF endings (consumers pin `eol=lf` in .gitattributes), the target is
// mirrored (files that no longer exist here are removed), and nothing is rewritten.
// Rule: change the engine only here, merge, then run this for each consumer.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO, 'packages', 'mail-engine', 'src');

function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** LF-normalised content of a file. The engine is all text, so no binary branch is needed. */
function lf(file) {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function commit() {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
    const sha = git('rev-parse', 'HEAD');
    const dirty = git('status', '--porcelain', '--', 'packages/mail-engine').length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return 'unknown';
  }
}

function main(argv) {
  const check = argv.includes('--check');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target) {
    console.error('usage: node scripts/sync-mail-engine.mjs [--check] <target-dir>');
    return 2;
  }
  const dest = resolve(target);
  if (dest === SOURCE || dest.startsWith(SOURCE + sep)) {
    console.error('refusing to sync into the source directory');
    return 2;
  }

  const files = listFiles(SOURCE);
  if (files.length === 0) {
    console.error(`no files under ${SOURCE}`);
    return 2;
  }

  if (check) {
    const have = listFiles(dest);
    const problems = [];
    for (const f of files) {
      if (!have.includes(f)) problems.push(`missing: ${f}`);
      else if (lf(join(SOURCE, f)) !== lf(join(dest, f))) problems.push(`differs: ${f}`);
    }
    for (const f of have) if (!files.includes(f)) problems.push(`extra: ${f}`);
    if (problems.length > 0) {
      console.error(`${dest} is out of step with snap-app ${commit()}:\n  ${problems.join('\n  ')}`);
      return 1;
    }
    console.log(`${dest} matches snap-app ${commit()} (${files.length} files)`);
    return 0;
  }

  for (const f of listFiles(dest)) if (!files.includes(f)) rmSync(join(dest, f));
  for (const f of files) {
    const to = join(dest, f);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, lf(join(SOURCE, f)));
  }
  // Drop directories the mirror emptied.
  const prune = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) prune(join(dir, entry.name));
    }
    if (dir !== dest && existsSync(dir) && readdirSync(dir).length === 0 && statSync(dir).isDirectory()) rmSync(dir, { recursive: true });
  };
  prune(dest);
  console.log(`Synced ${files.length} files from snap-app@${commit()} to ${dest}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
