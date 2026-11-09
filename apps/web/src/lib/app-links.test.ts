import { describe, expect, it } from 'vitest';

import { GET } from '@/app/.well-known/assetlinks.json/route';
import { assetLinks, certFingerprints } from '@/lib/app-links';

describe('assetlinks.json', () => {
  it('serves 200 JSON with the package and the release key, no redirect', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('location')).toBeNull();
    const body = await res.json();
    expect(body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'au.com.snapapps.app',
          sha256_cert_fingerprints: ['06:C6:54:57:09:01:57:3C:27:03:84:9E:D8:8E:C9:C9:5B:38:98:6A:52:ED:51:79:CB:DE:76:21:E0:D3:44:66'],
        },
      },
    ]);
  });

  it('takes extra fingerprints from the environment, colons optional', () => {
    const release = 'ab'.repeat(32);
    const fps = certFingerprints(`${release}, ${'CD:'.repeat(31)}CD`);
    expect(fps).toEqual(['AB:'.repeat(31) + 'AB', 'CD:'.repeat(31) + 'CD']);
    expect(assetLinks(release)[0]!.target.sha256_cert_fingerprints).toEqual([fps[0]]);
  });

  it('refuses a malformed fingerprint', () => {
    expect(() => certFingerprints('nope')).toThrow(/64 hex/);
  });
});
