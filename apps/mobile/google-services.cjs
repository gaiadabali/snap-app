'use strict';

/**
 * Where the Firebase `google-services.json` comes from for a build.
 *
 * New-mail alerts (Spambank, spambank/BUILD.md B9/§4.9) arrive by Firebase Cloud
 * Messaging, and an Android build can only receive them when it carries the Firebase
 * project's `google-services.json`. That file is never committed (it names the
 * project's API key); it is supplied at build time by pointing `GOOGLE_SERVICES_FILE`
 * at it:
 *
 *   GOOGLE_SERVICES_FILE=/path/to/google-services.json deploy/build-apk.sh
 *
 * Without it the build still succeeds and the app runs; notifications are simply off
 * (src/lib/push.ts treats "no Firebase" as "no alerts" and says so on the Mail
 * settings screen). That is deliberate: the Firebase project is not created yet, and
 * a missing optional file must not stop an APK being built.
 *
 * Returns the absolute path to give Expo, or `null` for "build without Firebase".
 * A variable that is SET but names a file that does not exist throws: that is a
 * mistake in how the build was started, and a build that quietly lost its alerts
 * would be noticed only on a phone.
 */
const path = require('node:path');

/**
 * @param {string | undefined} value  `process.env.GOOGLE_SERVICES_FILE`
 * @param {string} cwd                where a relative path is read from (apps/mobile)
 * @param {(file: string) => boolean} exists
 * @returns {string | null}
 */
function googleServicesFile(value, cwd, exists) {
  const raw = (value ?? '').trim();
  if (raw === '') return null;
  const file = path.resolve(cwd, raw);
  if (!exists(file)) {
    throw new Error(
      `GOOGLE_SERVICES_FILE is set to "${raw}", but there is no file at ${file}. ` +
        'Point it at the Firebase google-services.json, or unset it to build without notifications.',
    );
  }
  return file;
}

module.exports = { googleServicesFile };
