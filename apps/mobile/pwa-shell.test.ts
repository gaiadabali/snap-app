import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The web export is installable ("Add to Home Screen" on iPhone, "Install app" on
 * Chrome). That depends on `public/` being shipped with the export and on the head
 * tags in `public/index.html`, neither of which any type check or render test
 * would notice losing. The built output is checked separately (see the PR).
 */
const PUBLIC = path.resolve(import.meta.dirname, 'public');
const read = (f: string) => readFileSync(path.join(PUBLIC, f), 'utf8');

type Icon = { src: string; sizes: string; type: string; purpose?: string };
const manifest = JSON.parse(read('manifest.webmanifest')) as Record<string, unknown> & { icons: Icon[] };

describe('web app manifest', () => {
  it('is a standalone app rooted at /', () => {
    expect(manifest).toMatchObject({
      name: 'SnapApp',
      short_name: 'SnapApp',
      start_url: '/',
      scope: '/',
      display: 'standalone',
    });
    expect(manifest.background_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(manifest.theme_color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('has 192, 512 and maskable 512 icons that exist and are the size they claim', () => {
    const find = (sizes: string, purpose: string) => manifest.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    for (const [sizes, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']] as const) {
      const icon = find(sizes, purpose);
      expect(icon, `${sizes} ${purpose}`).toBeDefined();
      expect(icon!.type).toBe('image/png');
      const file = path.join(PUBLIC, icon!.src.replace(/^\//, ''));
      expect(existsSync(file), icon!.src).toBe(true);
      // PNG header: width and height are big-endian u32 at bytes 16 and 20.
      const png = readFileSync(file);
      const w = png.readUInt32BE(16);
      expect(`${w}x${png.readUInt32BE(20)}`).toBe(sizes);
    }
  });
});

describe('index.html head', () => {
  const html = read('index.html');

  it.each([
    '<link rel="manifest" href="/manifest.webmanifest"',
    '<link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon-180.png"',
    '<meta name="apple-mobile-web-app-capable" content="yes"',
    '<meta name="mobile-web-app-capable" content="yes"',
    '<meta name="apple-mobile-web-app-status-bar-style"',
    '<meta name="apple-mobile-web-app-title" content="SnapApp"',
    '<meta name="theme-color"',
    'viewport-fit=cover',
  ])('has %s', (needle) => {
    expect(html).toContain(needle);
  });

  it('keeps the placeholders Expo fills in', () => {
    expect(html).toContain('%LANG_ISO_CODE%');
    expect(html).toContain('%WEB_TITLE%');
    expect(html).toContain('<div id="root"></div>');
  });

  it('has the 180x180 touch icon', () => {
    const f = path.join(PUBLIC, 'pwa', 'apple-touch-icon-180.png');
    expect(statSync(f).size).toBeGreaterThan(0);
    expect(readFileSync(f).readUInt32BE(16)).toBe(180);
  });
});
