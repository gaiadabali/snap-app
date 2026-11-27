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
 *
 * It also decides whether the build carries Firebase. New-mail alerts arrive by Firebase
 * Cloud Messaging and need the project's `google-services.json`, which is never committed:
 * a build supplies it through `GOOGLE_SERVICES_FILE` (see `google-services.cjs`). Without it
 * the build still succeeds and the app runs, with notifications off.
 */
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');

const { computeBuild } = require('./build-version.cjs');
const { googleServicesFile } = require('./google-services.cjs');

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

  const googleServices = googleServicesFile(process.env.GOOGLE_SERVICES_FILE, __dirname, existsSync);

  return {
    ...config,
    version,
    android: {
      ...config.android,
      versionCode,
      // Firebase, for new-mail alerts. Absent: no `googleServicesFile` key at all, so Expo
      // adds no Google services plugin and the build is exactly what it was before.
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
      // Google Play Billing (8.3.b) is only for the Play build; expo-iap's
      // manifest would otherwise give the website APK the billing permission.
      blockedPermissions:
        process.env.EXPO_PUBLIC_DISTRIBUTION === 'play'
          ? config.android?.blockedPermissions
          : [...(config.android?.blockedPermissions ?? []), 'com.android.vending.BILLING'],
      // Sign in with YourTal returns here (3.3.e). Android verifies it against
      // https://<host>/.well-known/assetlinks.json. Keep in step with
      // YOURTAL_REDIRECT_URI in src/lib/yourtal-signin.ts.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'snapapp.gaiada.com', path: '/oauth/yourtal' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    extra: { ...config.extra, versionCode },
  };
};
