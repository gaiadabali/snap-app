import { config } from '@/lib/config';

// Behind the reverse proxy the standalone Next server's `request.url` carries its own
// bind address (e.g. https://0.0.0.0:3000), so never build a redirect from it.
export function publicUrl(path: string): URL {
  return new URL(path, config.publicUrl.replace(/\/+$/, '') + '/');
}
