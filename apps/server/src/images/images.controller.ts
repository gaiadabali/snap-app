import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { getCaptureOriginalForImage, getCapturePageForImage } from '../repo.js';
import { get as readObject } from '../storage.js';
import { readImageToken } from '../tokens.js';

/**
 * Fetching a document's image bytes.
 *
 * Deliberately OUTSIDE `SessionGuard` and `MembershipGuard` — see
 * `docs/contracts/phase0-multipage.md` §8. `DocumentView.imageUrl` and
 * `pages[].imageUrl` are read by `<Image source={{uri}}>`, which cannot
 * attach an `Authorization` header (and on web, `react-native-web` renders a
 * plain `<img>`, which cannot either). So the token in the path IS the
 * credential, exactly as `/v1/uploads/:token` and `/v1/downloads/:token`
 * already work: signed, scoped to one tenant and one capture, short-lived,
 * and minted fresh on every document read rather than stored anywhere.
 *
 * The token authorises the URL; it does not bypass the tenant check. Both
 * repo reads it can lead to (`getCaptureOriginalForImage`,
 * `getCapturePageForImage`) go through `withTenant`, which sets the RLS
 * tenant context from the token's own `tenantId` before running — a token
 * naming a capture that belongs to a different tenant finds nothing, the
 * same way any other cross-tenant read finds nothing.
 */
@ApiTags('images')
@Controller('v1/images')
export class ImagesController {
  @Get(':token')
  @ApiOperation({
    summary: 'Fetch a document or page image',
    description:
      'Authenticated by the signed token in the path, because the recipient is an <Image> element, not a fetch call that can carry a header. Short-lived — see IMAGE_TTL_SECONDS.',
  })
  async image(
    @Param('token') token: string,
    @Res() reply: {
      header: (k: string, v: string) => void;
      send: (b: Buffer) => void;
    },
  ): Promise<void> {
    const claim = readImageToken(token);
    // One message for a forged token and an expired one, exactly as
    // `/v1/downloads/:token` does — distinguishing them tells someone probing
    // which of their guesses was structurally valid.
    if (!claim) throw new NotFoundException('This link has expired or is not valid.');

    // `pageNumber === 0` is the token's convention for "the capture's
    // original bytes" — what `DocumentView.imageUrl` has always pointed at.
    // Anything else is a 1-based `capture_pages` entry — what
    // `DocumentView.pages[].imageUrl` has always pointed at. See the comment
    // on `Payload.p` in `tokens.ts`.
    const found =
      claim.pageNumber === 0
        ? await getCaptureOriginalForImage(claim.tenantId, claim.captureId)
        : await getCapturePageForImage(claim.tenantId, claim.captureId, claim.pageNumber);
    if (!found) throw new NotFoundException('This link has expired or is not valid.');

    let bytes: Buffer;
    try {
      bytes = readObject(found.key);
    } catch {
      throw new NotFoundException('That image is no longer available.');
    }

    reply.header('Content-Type', found.mime);
    // `private, no-store`: a receipt image behind a bearer URL is exactly the
    // kind of thing a shared cache must never hold, same reasoning as
    // `/v1/downloads/:token`.
    reply.header('Cache-Control', 'private, no-store');
    reply.send(bytes);
  }
}
