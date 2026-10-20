import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, WORKSPACE_COOKIE } from '@/lib/api/server';
import { endServerSession } from '@/lib/auth/session';

/**
 * Sign-out. Ends the session on the API (it is a row there since 0036, so
 * a copied cookie stops working too), then clears BOTH cookies — the session
 * and the active workspace — and always lands on `/sign-in`. A form posting
 * here needs no `Idempotency-Key`: ending a session that is already over is
 * a no-op, not a duplicate side effect.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  await endServerSession();
  const response = NextResponse.redirect(new URL('/sign-in', request.url));
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(WORKSPACE_COOKIE);
  return response;
}
