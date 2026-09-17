/**
 * Class joiner, in its own module so `index.tsx` and `assets.tsx` can both use
 * it without importing each other. `index.tsx` re-exports it, so the public
 * import path is unchanged: `import { cx } from '@/design/primitives'`.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
