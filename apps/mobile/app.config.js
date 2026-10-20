'use strict';

/**
 * Expo's dynamic config: app.json, plus the two numbers that must rise with
 * every build.
 *
 *   android.versionCode  the commit count (or SNAP_BUILD_NUMBER)
 *   version              <app.json major.minor>.<same number>, e.g. 0.1.218
 *   extra.versionCode    the same number again, so the running app can read it
 *                        (src/lib/updates.ts; expo-constants embeds `extra`)
 *
 * Both `deploy/build-apk.sh` (expo prebuild) and EAS read this file, so there
 * is one place the number comes from. The rules and refusals are in
 * `build-version.cjs`, which has the tests.
 */
const { execFileSync } = require('node:child_process');

const { computeBuild } = require('./build-version.cjs');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    throw new Error(
      `Could not run \`git ${args.join(' ')}\` to number this build (${e.message.split('\n')[0]}). ` +
        'Build from a git checkout, or set SNAP_BUILD_NUMBER.',
    );
  }
}

module.exports = ({ config }) => {
  const { versionCode, version } = computeBuild({
    appVersion: config.version,
    override: process.env.SNAP_BUILD_NUMBER,
    readGit: () => ({
      count: git(['rev-list', '--count', 'HEAD']),
      shallow: git(['rev-parse', '--is-shallow-repository']) === 'true',
    }),
  });

  return {
    ...config,
    version,
    android: { ...config.android, versionCode },
    extra: { ...config.extra, versionCode },
  };
};
