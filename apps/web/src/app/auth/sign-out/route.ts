import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE, WORKSPACE_COOKIE } from '@/lib/api/server';

/**
 * Sign-out. Clears BOTH cookies — the session and the active workspace — and
 * always lands on `/sign-in`. A form posting here needs no
 * `Idempotency-Key`: deleting a cookie that is already gone is simply a
 * no-op, not a duplicate side effect.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL('/sign-in', request.url));
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete(WORKSPACE_COOKIE);
  return response;
}
