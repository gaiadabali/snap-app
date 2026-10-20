'use strict';

/**
 * What version and build number this build carries, worked out from git.
 *
 * WHY THE COMMIT COUNT. Every APK ever built said `0.1.0` with versionCode 1,
 * because nothing ever changed either. Android refuses to install over an app
 * whose versionCode is not HIGHER, and an update prompt that compares anything
 * else has to guess. `git rev-list --count HEAD` rises with every commit on
 * main, needs no counter file to forget to bump, and is the same number for
 * the same commit on any machine, so a rebuild of a commit is reproducible.
 *
 * Pure on purpose: the git facts are passed in, so the rules (and above all the
 * refusals) can be unit-tested without a repository. `app.config.js` is the
 * only caller that talks to git.
 */

/** Android's ceiling for versionCode. Far away, but a typo'd override should not reach it. */
const MAX_VERSION_CODE = 2100000000;

function parseCount(raw, what) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`${what} must be a whole number, got "${text}".`);
  }
  const n = Number(text);
  if (n < 1 || n > MAX_VERSION_CODE) {
    throw new Error(`${what} must be between 1 and ${MAX_VERSION_CODE}, got ${n}.`);
  }
  return n;
}

/**
 * @param {object} input
 * @param {string} input.appVersion app.json's `expo.version`, e.g. "0.1.0" - only major.minor is used.
 * @param {string | undefined} input.override value of SNAP_BUILD_NUMBER, if set (CI, EAS).
 * @param {() => { count: string | number, shallow: boolean }} input.readGit lazily asked, so an override never needs git.
 * @returns {{ versionCode: number, version: string }}
 */
function computeBuild({ appVersion, override, readGit }) {
  const mm = /^(\d+)\.(\d+)(?:\.|$)/.exec(String(appVersion ?? '').trim());
  if (!mm) {
    throw new Error(`app.json expo.version must start with major.minor (e.g. "0.1.0"), got "${appVersion}".`);
  }

  let versionCode;
  if (override !== undefined && String(override).trim() !== '') {
    versionCode = parseCount(override, 'SNAP_BUILD_NUMBER');
  } else {
    const git = readGit();
    // A shallow clone counts the commits it fetched - often 1 - and would
    // stamp a build that Android treats as OLDER than everything installed.
    // Refusing is the only safe answer.
    if (git.shallow) {
      throw new Error(
        'This is a shallow git clone, so the commit count (the build number) would be wrong. ' +
          'Run `git fetch --unshallow`, or set SNAP_BUILD_NUMBER explicitly.',
      );
    }
    versionCode = parseCount(git.count, 'The git commit count');
  }

  return { versionCode, version: `${mm[1]}.${mm[2]}.${versionCode}` };
}

module.exports = { computeBuild, MAX_VERSION_CODE };
