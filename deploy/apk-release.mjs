#!/usr/bin/env node
/**
 * The GitHub Release half of the Android pipeline: what CI writes into a
 * release (`build.json`) and how the host picks a release to place.
 *
 * Used by `.github/workflows/android-release.yml` (build-json) and
 * `deploy/pull-apk.sh` (pick-release, check-build). No dependencies, like
 * release-notes.mjs, because the host runs it.
 *
 * Commands:
 *
 *   build-json --notes FILE --tag TAG --version V --version-code N --commit SHA
 *              --api-url URL --sha256 HEX --size BYTES --out FILE
 *       Write build.json: the facts about the APK plus the release-notes entry
 *       ({ id, date, notes }, the newest in --notes) this build will carry.
 *
 *   check-build FILE
 *       Validate a build.json. Exit 1 listing every problem; on success print
 *       nothing.
 *
 *   pick-release FILE [--repo OWNER/NAME]
 *       FILE is the response of GET /repos/{repo}/releases. Print, as JSON,
 *       { tag, id, assets: { apk, sha256, build } } (download URLs) for the
 *       newest release that is a PUBLISHED, non-prerelease `android-v*` release
 *       with all three assets. Print nothing when there is none.
 *
 * The tag is `android-v<version>`, where version is exactly what the APK says
 * (`0.1.<commit count>`), so a tag and its APK can never disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const TAG_PREFIX = 'android-v';
export const APK_ASSET = 'snap-apps-android.apk';
export const SHA_ASSET = 'snap-apps-android.apk.sha256';
export const BUILD_ASSET = 'build.json';

export function tagFor(version) {
  return `${TAG_PREFIX}${version}`;
}

/** Every problem with a build.json object, as strings. Empty means valid. */
export function validateBuild(b) {
  const problems = [];
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['build.json must be an object'];
  const str = (k) => typeof b[k] === 'string' && b[k] !== '';
  if (b.schema !== 1) problems.push('schema must be 1');
  for (const k of ['tag', 'version', 'commit', 'apiUrl']) if (!str(k)) problems.push(`${k} must be a non-empty string`);
  if (!Number.isSafeInteger(b.versionCode) || b.versionCode <= 0) problems.push('versionCode must be a positive whole number');
  if (!Number.isSafeInteger(b.byteSize) || b.byteSize <= 0) problems.push('byteSize must be a positive whole number');
  if (!(typeof b.sha256 === 'string' && /^[0-9a-f]{64}$/.test(b.sha256))) problems.push('sha256 must be 64 lowercase hex characters');
  if (str('commit') && !/^[0-9a-f]{7,40}$/i.test(b.commit)) problems.push('commit must be a 7-40 character hex sha');
  if (str('apiUrl') && !/^https?:\/\/[^\s]+$/.test(b.apiUrl)) problems.push('apiUrl must be an http(s) URL');
  if (str('version') && str('tag') && b.tag !== tagFor(b.version)) {
    problems.push(`tag ${b.tag} must be ${tagFor(b.version)}: the tag names the APK's own version`);
  }
  if (str('version') && Number.isSafeInteger(b.versionCode) && !b.version.endsWith(`.${b.versionCode}`)) {
    problems.push(`version ${b.version} must end in .${b.versionCode} (the build number)`);
  }
  const e = b.entry;
  if (!e || typeof e !== 'object') {
    problems.push('entry must be { id, date, notes }');
  } else {
    for (const k of ['id', 'date', 'notes']) {
      if (typeof e[k] !== 'string' || e[k] === '') problems.push(`entry.${k} must be a non-empty string`);
    }
  }
  return problems;
}

/** Newest published android-v* release with all three assets, or null. */
export function pickRelease(list) {
  if (!Array.isArray(list)) return null;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    if (r.draft === true || r.prerelease === true) continue;
    if (typeof r.tag_name !== 'string' || !r.tag_name.startsWith(TAG_PREFIX)) continue;
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const url = (name) => {
      const a = assets.find((x) => x && x.name === name && x.state !== 'starter');
      return a && typeof a.browser_download_url === 'string' ? a.browser_download_url : null;
    };
    const apk = url(APK_ASSET);
    const sha256 = url(SHA_ASSET);
    const build = url(BUILD_ASSET);
    // A release still uploading its assets is skipped, not half-used.
    if (!apk || !sha256 || !build) continue;
    return { tag: r.tag_name, id: r.id, assets: { apk, sha256, build } };
  }
  return null;
}

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      flags[a.slice(2)] = v;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s) }) {
  try {
    const [command, ...rest] = argv;
    const { positional, flags } = parseFlags(rest);

    if (command === 'build-json') {
      for (const k of ['notes', 'tag', 'version', 'version-code', 'commit', 'api-url', 'sha256', 'size', 'out']) {
        if (!flags[k]) throw new Error(`--${k} is required`);
      }
      const notes = readJsonFile(flags.notes);
      const newest = Array.isArray(notes) ? notes[0] : null;
      if (!newest) throw new Error(`${flags.notes} has no entries`);
      const build = {
        schema: 1,
        tag: flags.tag,
        version: flags.version,
        versionCode: Number(flags['version-code']),
        commit: flags.commit,
        apiUrl: flags['api-url'],
        sha256: flags.sha256,
        byteSize: Number(flags.size),
        entry: { id: newest.id, date: newest.date, notes: newest.notes },
      };
      const problems = validateBuild(build);
      if (problems.length > 0) {
        io.err('refusing to write build.json:');
        for (const p of problems) io.err(`  - ${p}`);
        return 1;
      }
      writeFileSync(flags.out, `${JSON.stringify(build, null, 2)}\n`, 'utf8');
      return 0;
    }

    if (command === 'check-build') {
      if (!positional[0]) throw new Error('check-build needs a file');
      let b;
      try {
        b = readJsonFile(positional[0]);
      } catch {
        io.err(`${positional[0]} is not readable JSON`);
        return 1;
      }
      const problems = validateBuild(b);
      if (problems.length > 0) {
        io.err(`${positional[0]} is not a valid build.json:`);
        for (const p of problems) io.err(`  - ${p}`);
        return 1;
      }
      return 0;
    }

    if (command === 'pick-release') {
      if (!positional[0]) throw new Error('pick-release needs a file');
      let list;
      try {
        list = readJsonFile(positional[0]);
      } catch {
        io.err(`${positional[0]} is not readable JSON`);
        return 1;
      }
      const picked = pickRelease(list);
      if (picked) io.out(JSON.stringify(picked));
      return 0;
    }

    io.err('usage: apk-release.mjs <build-json|check-build|pick-release> (see the header of this file)');
    return 2;
  } catch (e) {
    io.err(e.message);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
