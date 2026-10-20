#!/usr/bin/env node
/**
 * Release notes: validation, "which entry is this build?", and the draft.
 *
 * ONE SCRIPT, TWO CALLERS. `deploy/publish-apk.sh` runs it today and the CI
 * publish job (task 1.12.b) will run the same commands, so the rules cannot
 * drift between the laptop path and the pipeline path. It has no dependencies.
 *
 * THE MODEL (task 1.12.d/j/k). The words live in the repo, in
 * `apps/mobile/release-notes.json`: a list, newest first, each entry
 * `{ id, date, notes }`. They are NOT keyed by versionCode, because the
 * versionCode is the commit count at build time and the release PR's own squash
 * merge changes it, so nobody can know the number while writing the entry.
 *
 * The SERVER's `releases.json` is the history and the authority on which build
 * an entry became: `[{ id, versionCode, version, commit, publishedAt, notes }]`.
 * An entry is "new" when its id is not yet in that file. Publishing takes the
 * NEWEST entry; if it is already attached to a published build there is
 * nothing new to say, and the publish is refused with a draft to rewrite.
 *
 * Commands (all print JSON or text to stdout, problems to stderr):
 *
 *   check --notes FILE
 *       Validate the notes file. Exit 1 listing every problem.
 *
 *   pick --notes FILE --releases FILE [--manifest FILE] [--version-code N]
 *       Validate, then take the newest entry. Exit 0 and print it when its id
 *       is not in releases. Exit 1 and print the draft when it is. Passing
 *       --version-code lets a half-finished publish be resumed: an entry that
 *       is attached to THAT SAME versionCode is accepted again.
 *
 *   draft [--manifest FILE]
 *       The commit subjects since the last published commit, limited to
 *       apps/mobile and packages, as a draft to rewrite (never customer copy).
 *
 *   plan --notes FILE --releases FILE --manifest FILE --out-releases FILE
 *        --out-manifest FILE --version V --version-code N --commit SHA
 *        --published-at ISO --sha256 HEX --size BYTES --api-url URL
 *       `pick`, then write the next releases.json and manifest.json (the
 *       manifest gains `notes`). The caller moves them into place atomically.
 *
 * A missing or unreadable --releases file or --manifest file means "none yet".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Google Play's limit for release notes, and so the limit for every entry. */
export const MAX_NOTES_CHARS = 500;
export const MIN_SENTENCES = 2;
export const MAX_SENTENCES = 5;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Folders whose commits can change what a customer sees. */
export const DRAFT_PATHS = ['apps/mobile', 'packages'];

/**
 * Sentences are runs ending in . ! or ? followed by a space or the end. So the
 * notes must not use abbreviations with full stops ("e.g.", "approx."): they
 * would count as extra sentences, and a customer does not need them anyway.
 */
export function splitSentences(text) {
  return String(text)
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 0);
}

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Every problem with a notes list, as readable strings. Empty means valid.
 * Pure, so the repo's real file is checked by a unit test.
 */
export function validateNotes(entries) {
  const problems = [];
  if (!Array.isArray(entries)) return ['release-notes.json must be a JSON array of entries, newest first'];
  if (entries.length === 0) return ['release-notes.json has no entries'];

  const seen = new Set();
  entries.forEach((entry, i) => {
    const at = `entry ${i + 1}${entry && typeof entry.id === 'string' ? ` (${entry.id})` : ''}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at}: must be an object`);
      return;
    }
    const extra = Object.keys(entry).filter((k) => !['id', 'date', 'notes'].includes(k));
    if (extra.length > 0) problems.push(`${at}: unknown field(s) ${extra.join(', ')} (only id, date, notes)`);

    if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
      problems.push(`${at}: id must be a lowercase slug of 3-64 letters, digits and hyphens`);
    } else if (seen.has(entry.id)) {
      problems.push(`${at}: id "${entry.id}" is used twice`);
    } else {
      seen.add(entry.id);
    }

    if (!isRealDate(entry.date)) problems.push(`${at}: date must be a real YYYY-MM-DD date`);

    if (typeof entry.notes !== 'string' || entry.notes.trim() === '') {
      problems.push(`${at}: notes must be a non-empty string`);
    } else {
      const notes = entry.notes;
      if (notes !== notes.trim()) problems.push(`${at}: notes has leading or trailing whitespace`);
      if (/[\r\n]/.test(notes)) problems.push(`${at}: notes must be one paragraph with no line breaks`);
      if (notes.length > MAX_NOTES_CHARS) {
        problems.push(`${at}: notes is ${notes.length} characters; the limit is ${MAX_NOTES_CHARS} (Google Play)`);
      }
      const sentences = splitSentences(notes);
      if (sentences.length < MIN_SENTENCES || sentences.length > MAX_SENTENCES) {
        problems.push(`${at}: notes has ${sentences.length} sentence(s); write ${MIN_SENTENCES} to ${MAX_SENTENCES}`);
      }
      if (!/[.!?]$/.test(notes.trim())) problems.push(`${at}: notes must end with a full stop`);
    }
  });

  // Newest first: dates never increase down the list.
  for (let i = 1; i < entries.length; i++) {
    const a = entries[i - 1]?.date;
    const b = entries[i]?.date;
    if (isRealDate(a) && isRealDate(b) && b > a) {
      problems.push(`entry ${i + 1}: dated after the entry above it; the list is newest first`);
    }
  }
  return problems;
}

/**
 * Which entry would this publish carry?
 *
 * - `new`: the newest entry's id is in no published build.
 * - `resume`: it is attached to a build with THIS versionCode, i.e. an earlier
 *   run of the same publish died between its writes; record it again.
 * - `published`: attached to another build. There is nothing new to say.
 */
export function pickEntry(entries, releases, versionCode) {
  const entry = entries[0];
  const hit = releases.find((r) => r && r.id === entry.id);
  if (!hit) return { status: 'new', entry };
  if (versionCode !== undefined && Number(hit.versionCode) === Number(versionCode)) {
    return { status: 'resume', entry, release: hit };
  }
  return { status: 'published', entry, release: hit };
}

/** The draft: commit subjects as bullet lines, with a reminder they are not copy. */
export function formatDraft(subjects, sinceCommit) {
  const head = sinceCommit
    ? `Commit subjects since the last published build (${sinceCommit}), in apps/mobile and packages:`
    : 'Recent commit subjects in apps/mobile and packages (the last published commit is unknown):';
  const lines = subjects.length > 0 ? subjects.map((s) => `  - ${s}`) : ['  (none)'];
  return [
    head,
    ...lines,
    '',
    'These are a DRAFT, not customer copy ("Revert ...", "The gap check counts in BigInt").',
    `Add a new entry at the TOP of apps/mobile/release-notes.json: a new id, today's date, and`,
    `${MIN_SENTENCES} to ${MAX_SENTENCES} plain sentences (at most ${MAX_NOTES_CHARS} characters) a customer understands.`,
  ].join('\n');
}

/** Read JSON; anything missing, empty or corrupt is `fallback`. */
export function readJson(path, fallback) {
  if (!path || path === '-' || !existsSync(path)) return fallback;
  try {
    const text = readFileSync(path, 'utf8');
    if (text.trim() === '') return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** releases.json is an array; the API's `{ releases: [...] }` is accepted too. */
export function normaliseReleases(value) {
  const list = Array.isArray(value) ? value : Array.isArray(value?.releases) ? value.releases : [];
  return list.filter((r) => r && typeof r === 'object' && typeof r.id === 'string');
}

function gitSubjects(sinceCommit, run = execFileSync) {
  const args = (range) => ['log', '--no-merges', '--format=%s', ...range, '--', ...DRAFT_PATHS];
  try {
    if (sinceCommit) {
      const out = run('git', args([`${sinceCommit}..HEAD`]), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { subjects: out.split('\n').filter(Boolean), since: sinceCommit };
    }
  } catch {
    // The commit is not in this clone (shallow, or a different history). Fall
    // through to "recent", which says so.
  }
  try {
    const out = run('git', args(['-n', '30']), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { subjects: out.split('\n').filter(Boolean), since: null };
  } catch {
    return { subjects: [], since: null };
  }
}

/** The draft text for a manifest object (or null). Git is injectable for tests. */
export function draftFor(manifest, run) {
  const commit = typeof manifest?.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(manifest.commit) ? manifest.commit : null;
  const { subjects, since } = gitSubjects(commit, run);
  return formatDraft(subjects, since);
}

/**
 * The files a publish writes. Pure: the caller supplies everything, including
 * the clock. Newest release first; the manifest keeps every field it had.
 */
export function buildOutputs({ entry, releases, build }) {
  const record = {
    id: entry.id,
    versionCode: build.versionCode,
    version: build.version,
    commit: build.commit,
    publishedAt: build.publishedAt,
    notes: entry.notes,
  };
  const nextReleases = [record, ...releases.filter((r) => r.id !== entry.id)];
  const nextManifest = {
    version: build.version,
    versionCode: build.versionCode,
    buildNumber: build.commit,
    commit: build.commit,
    sha256: build.sha256,
    byteSize: build.byteSize,
    publishedAt: build.publishedAt,
    apiUrl: build.apiUrl,
    notes: entry.notes,
  };
  return { nextReleases, nextManifest };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`);
    flags[key] = value;
    i++;
  }
  return { command, flags };
}

function need(flags, ...names) {
  for (const n of names) if (!flags[n]) throw new Error(`--${n} is required`);
}

export function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  let command;
  let flags;
  try {
    ({ command, flags } = parseArgs(argv));
  } catch (e) {
    io.err(e.message);
    return 2;
  }

  try {
    if (command === 'draft') {
      io.out(draftFor(readJson(flags.manifest, null)));
      return 0;
    }

    if (!['check', 'pick', 'plan'].includes(command)) {
      io.err('usage: release-notes.mjs <check|pick|draft|plan> [options] (see the header of this file)');
      return 2;
    }

    need(flags, 'notes');
    const entries = readJson(flags.notes, null);
    const problems = validateNotes(entries);
    if (problems.length > 0) {
      io.err(`${flags.notes} is not valid:`);
      for (const p of problems) io.err(`  - ${p}`);
      return 1;
    }
    if (command === 'check') {
      io.out(`ok: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest "${entries[0].id}"`);
      return 0;
    }

    need(flags, 'releases');
    const releases = normaliseReleases(readJson(flags.releases, []));
    const manifest = readJson(flags.manifest, null);
    const versionCode = flags['version-code'] !== undefined ? Number(flags['version-code']) : undefined;
    const picked = pickEntry(entries, releases, versionCode);

    if (picked.status === 'published') {
      io.err(`Refusing to publish: the newest release note "${picked.entry.id}" is already attached to build ${picked.release.versionCode} (${picked.release.version}).`);
      io.err('A new build needs a new entry, so the people who get it are told what changed.');
      io.err('');
      io.err(draftFor(manifest));
      return 1;
    }

    if (command === 'pick') {
      io.out(JSON.stringify({ status: picked.status, entry: picked.entry }));
      return 0;
    }

    need(flags, 'out-releases', 'out-manifest', 'version', 'version-code', 'commit', 'published-at', 'sha256', 'size', 'api-url');
    const build = {
      version: flags.version,
      versionCode,
      commit: flags.commit,
      publishedAt: flags['published-at'],
      sha256: flags.sha256,
      byteSize: Number(flags.size),
      apiUrl: flags['api-url'],
    };
    if (!Number.isInteger(build.versionCode) || build.versionCode <= 0) throw new Error('--version-code must be a positive whole number');
    if (!Number.isInteger(build.byteSize) || build.byteSize <= 0) throw new Error('--size must be a positive whole number');
    const { nextReleases, nextManifest } = buildOutputs({ entry: picked.entry, releases, build });
    writeFileSync(flags['out-releases'], `${JSON.stringify(nextReleases, null, 2)}\n`, 'utf8');
    writeFileSync(flags['out-manifest'], `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    io.out(`${picked.status}: release note "${picked.entry.id}" -> build ${build.versionCode} (${build.version})`);
    return 0;
  } catch (e) {
    io.err(e.message);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
