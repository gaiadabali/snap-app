import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const makeConfig = require('./app.config.js') as (a: { config: Record<string, unknown> }) => {
  android: { intentFilters: { autoVerify: boolean; data: { scheme: string; host: string; path: string }[] }[] };
};

/**
 * The Sign in with YourTal App Link (3.3.e). On older Android, autoVerify needs EVERY listed
 * host to verify, so the host that no longer resolves (snapapp.gaiada.com, gone 2026-11-27)
 * must never come back, and the host must be the one serving /.well-known/assetlinks.json.
 */
describe('App Link intent filter', () => {
  const { android } = makeConfig({ config: { version: '0.1', android: {} } });

  it('lists snapapps.gaiada.com/oauth/yourtal, auto-verified, and no other host', () => {
    expect(android.intentFilters).toHaveLength(1);
    const f = android.intentFilters[0]!;
    expect(f.autoVerify).toBe(true);
    expect(f.data).toEqual([{ scheme: 'https', host: 'snapapps.gaiada.com', path: '/oauth/yourtal' }]);
  });
});
