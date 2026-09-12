import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { get as readObject } from '../storage.js';
import { readDownloadToken } from '../tokens.js';

/**
 * Fetching an assembled export.
 *
 * Deliberately OUTSIDE `SessionGuard` and `MembershipGuard`, and that is the
 * whole design rather than an oversight: this URL is handed to a browser or a
 * share sheet, which sends no `Authorization` header and no `X-Workspace-Id`.
 * The token in the path IS the credential — signed, scoped to one storage key
 * and one tenant, and valid for ten minutes.
 *
 * The consequences are accepted on purpose. A link can be forwarded, so it
 * expires quickly; it names one object, so it cannot be edited into another;
 * and it carries the tenant, so a key from one workspace cannot be fetched
 * under another's token.
 */
@ApiTags('downloads')
@Controller('v1/downloads')
export class DownloadsController {
  @Get(':token')
  @ApiOperation({
    summary: 'Fetch a prepared export',
    description:
      'Authenticated by the signed token in the path, because the recipient is a browser. Short-lived: ten minutes from issue.',
  })
  async download(
    @Param('token') token: string,
    @Res() reply: {
      header: (k: string, v: string) => void;
      send: (b: Buffer) => void;
    },
  ): Promise<void> {
    const claim = readDownloadToken(token);
    // One message for a forged token and an expired one. Distinguishing them
    // tells someone probing which of their guesses was structurally valid.
    if (!claim) throw new NotFoundException('This link has expired or is not valid.');

    // Not an ordinary object key: `oauth:` states are issued with the same
    // token kind, and must never be fetchable as a file.
    if (claim.key.startsWith('oauth:')) {
      throw new NotFoundException('This link has expired or is not valid.');
    }
    // The token names a tenant; the key must live under that tenant's prefix.
    // Belt and braces with the signature — a key is only ever put into a token
    // by us, so this can only fire if that stops being true.
    if (!claim.key.startsWith(`${claim.tenantId}/`)) {
      throw new NotFoundException('This link has expired or is not valid.');
    }

    let bytes: Buffer;
    try {
      bytes = readObject(claim.key);
    } catch {
      throw new NotFoundException('That export is no longer available. Prepare it again.');
    }

    reply.header('Content-Type', 'application/zip');
    // `private, no-store`: this is a tax record behind a bearer URL, and a
    // shared cache holding it is a shared cache leaking it.
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Disposition', 'attachment');
    reply.send(bytes);
  }
}
