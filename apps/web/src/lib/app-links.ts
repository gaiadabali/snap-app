/**
 * Android App Links (RFC 8252 §7.2): the phone app returns from YourTal on
 * https://<this site>/oauth/yourtal, which Android hands only to the app whose
 * package and signing certificate this file's output names.
 */
export const ANDROID_PACKAGE = 'au.com.snapapps.app';

/** The public React Native debug key every build is signed with today (docs/BUILD.md). */
const DEBUG_KEY_SHA256 = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

/**
 * SHA-256 fingerprints of the signing certificates, `ANDROID_CERT_SHA256`
 * (comma-separated hex, colons optional) or the debug key when unset. Add the
 * private release key (plan 8.1) next to the debug one, then drop the debug one.
 */
export function certFingerprints(env: string | undefined = process.env.ANDROID_CERT_SHA256): string[] {
  const raw = env?.trim() ? env.split(',') : [DEBUG_KEY_SHA256];
  return raw.map((f) => {
    const hex = f.replace(/[:\s]/g, '').toUpperCase();
    if (!/^[0-9A-F]{64}$/.test(hex)) throw new Error('ANDROID_CERT_SHA256 must be SHA-256 fingerprints (64 hex digits each)');
    return hex.match(/../g)!.join(':');
  });
}

export function assetLinks(env?: string) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: certFingerprints(env),
      },
    },
  ];
}
