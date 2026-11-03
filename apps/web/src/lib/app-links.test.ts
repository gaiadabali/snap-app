import { describe, expect, it } from 'vitest';

import { GET } from '@/app/.well-known/assetlinks.json/route';
import { assetLinks, certFingerprints } from '@/lib/app-links';

describe('assetlinks.json', () => {
  it('serves 200 JSON with the package and the debug key, no redirect', async () => {
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
          sha256_cert_fingerprints: ['FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'],
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
