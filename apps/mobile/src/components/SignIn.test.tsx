import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// `@/api` reaches into expo-secure-store, which Node cannot load; the effects
// that would call it never run in a static render.
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('@/api', () => ({
  api: () => ({}),
  ApiError: class ApiError extends Error {},
}));

import { SignIn } from './SignIn';

/**
 * The sign-in screen on the web build must pass axe landmark-one-main,
 * page-has-heading-one and region (live check 2026-11-27): exactly one main
 * landmark, exactly one h1, and nothing outside the landmark.
 */
describe('SignIn (web render)', () => {
  const html = renderToStaticMarkup(createElement(SignIn, { onSignedIn: () => {} }));

  it('has exactly one main landmark', () => {
    expect(html.match(/<main[\s>]/g)?.length).toBe(1);
  });

  it('has exactly one h1', () => {
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain('Receipts into records');
  });

  it('puts all content inside main', () => {
    const body = html.slice(html.indexOf('<main'), html.lastIndexOf('</main>'));
    expect(body).toContain('Receipts into records');
    // The wrapper that carries the ground colour holds nothing but <main>.
    const before = html.slice(0, html.indexOf('<main')).replace(/<div[^>]*>/g, '');
    expect(before.trim()).toBe('');
  });
});
