import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { googleServicesFile } = require('./google-services.cjs') as {
  googleServicesFile: (value: string | undefined, cwd: string, exists: (file: string) => boolean) => string | null;
};

const CWD = path.resolve('/repo/apps/mobile');

describe('googleServicesFile', () => {
  it('builds without Firebase when nothing is supplied', () => {
    expect(googleServicesFile(undefined, CWD, () => false)).toBeNull();
    expect(googleServicesFile('', CWD, () => false)).toBeNull();
    expect(googleServicesFile('   ', CWD, () => false)).toBeNull();
  });

  it('returns the absolute path of a file that exists', () => {
    const abs = path.resolve('/secrets/google-services.json');
    expect(googleServicesFile(abs, CWD, (f) => f === abs)).toBe(abs);
  });

  it('resolves a relative path against the app folder', () => {
    const want = path.resolve(CWD, 'secrets/google-services.json');
    expect(googleServicesFile(' secrets/google-services.json ', CWD, (f) => f === want)).toBe(want);
  });

  it('refuses a path that is set but missing, naming it', () => {
    expect(() => googleServicesFile('nope.json', CWD, () => false)).toThrow(/GOOGLE_SERVICES_FILE is set to "nope\.json"/);
  });
});
