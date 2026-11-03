import { assetLinks } from '@/lib/app-links';

/** Read per request so a fingerprint added in the environment needs no rebuild. */
export const dynamic = 'force-dynamic';

/** Android fetches this directly: 200, JSON, no redirect (Digital Asset Links). */
export function GET(): Response {
  return Response.json(assetLinks(), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
