import { NextRequest, NextResponse } from 'next/server';

import { ApiError, api } from '@/lib/api/server';
import { loadWorkspace } from '@/lib/panels/workspace';

/**
 * The deduction file for Free Tax Returns, as a download.
 *
 * Asks the API for the signed-in person's personal workspace and hands the JSON
 * back as an attachment. The browser never holds the API token: it calls this,
 * and this calls the API (see `lib/api/server.ts`).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return NextResponse.json({ message: 'No personal workspace yet.' }, { status: 404 });

  const fy = request.nextUrl.searchParams.get('fy');
  try {
    const bundle = await api<{ financialYear: string }>(
      `/v1/deduction-bundle${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`,
      { workspaceId: workspace.id },
    );
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="snap-deductions-${bundle.financialYear}.json"`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    throw error;
  }
}
