/**
 * Android App Links (RFC 8252 §7.2): the phone app returns from YourTal on
 * https://<this site>/oauth/yourtal, which Android hands only to the app whose
 * package and signing certificate this file's output names.
 */
export const ANDROID_PACKAGE = 'au.com.snapapps.app';

/**
 * The private release key every APK is signed with since 8.1 (android-v0.1.290,
 * CN=Snap Apps). The old public debug key is deliberately absent: anyone can sign
 * with it, so listing it would let any sideloaded build catch the sign-in.
 */
const RELEASE_KEY_SHA256 = '06c654570901573c2703849ed88ec9c95b38986a52ed5179cbde7621e0d34466';

/**
 * SHA-256 fingerprints of the signing certificates, `ANDROID_CERT_SHA256`
 * (comma-separated hex, colons optional) or the release key when unset.
 */
export function certFingerprints(env: string | undefined = process.env.ANDROID_CERT_SHA256): string[] {
  const raw = env?.trim() ? env.split(',') : [RELEASE_KEY_SHA256];
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
