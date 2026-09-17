import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { saveFieldGrounding, saveLayout } from '../repo.js';
import { putAt } from '../storage.js';

/**
 * What the phone read, recorded beside what the server read.
 *
 * `docs/ON-DEVICE.md` §3.5 (OD-7). The device's reading is ADVISORY: it exists
 * so a preview can appear before the upload finishes, and so Stage 2 can
 * compare two architecturally different readers for free.
 *
 * WHAT THIS ENDPOINT MAY NOT DO, and why it is a separate controller rather
 * than another method on `CapturesController`. It writes exactly two things: a
 * `document_layouts` row with `shadow = true` and `extraction_run_id = NULL`,
 * and its grounding rows. It may not write `documents`, `extraction_runs` or
 * `review_tasks`. §3.5 rule 2 says a test should delete that guarantee and
 * watch the test fail — so the guarantee is structural: this file imports
 * `saveLayout` and `saveFieldGrounding` and nothing else that writes.
 *
 * A DELIBERATE REVISION of `docs/OCR.md` §4.9, recorded as D38: §4.9 said the
 * device reading is "stored as an extraction run with engine = 'device'". It is
 * stored as a LAYOUT instead. An `extraction_runs` row is the thing
 * `documents.current_run_id` can point at, and keeping the device out of that
 * table makes "the preview may never become the record" a property of the
 * schema rather than of anybody's discipline.
 */

/** §3.5: 256 KB per page. A 40-line docket's DocDOM is ~30 KB. */
const MAX_BYTES_PER_PAGE = 256 * 1024;
const SUPPORTED_DOCDOM_VERSION = '1.0.0';
/** The only engines that may claim to be a device reading. */
const DEVICE_ENGINES = new Set(['device-vision', 'device-mlkit']);

type Box = { x: number; y: number; width: number; height: number };

export class DeviceReadingDto {
  engine!: string;
  engineVersion!: string;
  docdom!: {
    version?: string;
    pages?: Array<{ number?: number; width?: number; height?: number }>;
    blocks?: Array<{ lines?: Array<{ spans?: unknown[] }> }>;
    unreadable?: unknown[];
  };
  preview?: Record<
    string,
    {
      value: string | null;
      grounded?: boolean;
      spanIds?: string[];
      box?: Box | null;
      page?: number | null;
      confidence?: number;
    }
  >;
  timings?: { recogniseMs?: number; structureMs?: number };
  device?: { platform?: string; osVersion?: string; model?: string; totalMemoryMb?: number };
}

@ApiTags('captures')
@Controller('v1/captures/:captureId/device-reading')
@UseGuards(SessionGuard, MembershipGuard)
export class DeviceReadingController {
  @Post()
  // 202, not 201: the reading is accepted for the record and nothing
  // downstream waits on it. It is not a resource the caller will fetch.
  @HttpCode(202)
  @ApiOperation({
    summary: "Record what the device's own recogniser read for a capture",
    description:
      'Advisory and shadow-only. Writes one document_layouts row (shadow, no extraction run) and its grounding rows; never documents, extraction_runs or review_tasks. Never blocks or reorders extraction.',
  })
  async record(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('captureId') captureId: string,
    @Body() body: DeviceReadingDto,
  ): Promise<{ layoutId: string }> {
    if (!DEVICE_ENGINES.has(body?.engine)) {
      throw new HttpException(
        `engine must be one of ${[...DEVICE_ENGINES].join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const docdom = body?.docdom;
    // §3.5 rule 3: a DocDOM without version 1.0.0 is 422. The contract is
    // versioned precisely so a future shape cannot be silently half-read.
    if (!docdom || docdom.version !== SUPPORTED_DOCDOM_VERSION) {
      throw new HttpException(
        `docdom.version must be ${SUPPORTED_DOCDOM_VERSION}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const pages = docdom.pages ?? [];
    if (pages.length === 0) {
      throw new HttpException('docdom must have at least one page', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const json = Buffer.from(JSON.stringify(docdom), 'utf8');
    // 413 BEFORE any parsing work proportional to the payload.
    if (json.byteLength > MAX_BYTES_PER_PAGE * pages.length) {
      throw new HttpException(
        `docdom is ${json.byteLength} bytes; the cap is ${MAX_BYTES_PER_PAGE} per page`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    assertBoxesInsidePages(docdom, body.preview);

    // §3.5 rule 5: beside the shadow layouts, so `latestLayout` semantics and
    // the retention job need no special case for device readings.
    const storageKey = `${tenantId}/layouts/${captureId}/device-${randomUUID()}.json`;
    putAt(storageKey, json);

    const { layoutId } = await saveLayout(user.userId, tenantId, {
      captureId,
      // NULL, always. This reading did not come from an extraction run and
      // must never be pointed at by documents.current_run_id.
      extractionRunId: null,
      storageKey,
      docdomVersion: SUPPORTED_DOCDOM_VERSION,
      pageCount: pages.length,
      engineIds: [body.engine],
      spanCount: countSpans(docdom),
      unreadableCount: (docdom.unreadable ?? []).length,
      // Advisory. A layout that fed a real document is not.
      shadow: true,
      // 0028. The phone already measures its own memory on every capture and
      // the value reached this handler and was dropped. §1.2's 4GB floor is a
      // support DECISION nobody has evidence for; storing this is what turns
      // it into a query after a few hundred captures.
      deviceMeta: (body.device ?? {}) as Record<string, unknown>,
    });

    const grounding = Object.entries(body.preview ?? {})
      // A field the structurer abstained on is not evidence of anything and
      // has no span to point at. Storing it would make "grounded" meaningless.
      .filter(([, field]) => field && field.value !== null)
      .map(([fieldPath, field]) => ({
        captureId,
        layoutId,
        fieldPath,
        value: String(field.value),
        grounded: Boolean(field.grounded),
        spanIds: field.spanIds ?? [],
        box: field.box ?? null,
        page: field.page ?? null,
        confidence: Number.isFinite(field.confidence) ? Number(field.confidence) : 0,
      }));

    if (grounding.length > 0) {
      await saveFieldGrounding(user.userId, tenantId, grounding);
    }

    return { layoutId };
  }
}

/**
 * §3.5 rule 3: a box outside its page is 422.
 *
 * "A coordinate bug should fail loudly at the seam." The whole value of a
 * grounded field is that a highlight lands on the ink it names; a box beyond
 * the page means the device's scale-back arithmetic is wrong, and accepting it
 * stores a pointer to nowhere that surfaces later as a highlight in the margin.
 */
function assertBoxesInsidePages(
  docdom: DeviceReadingDto['docdom'],
  preview: DeviceReadingDto['preview'],
): void {
  const sizes = new Map<number, { width: number; height: number }>();
  for (const page of docdom.pages ?? []) {
    if (typeof page.number !== 'number') continue;
    sizes.set(page.number, { width: Number(page.width) || 0, height: Number(page.height) || 0 });
  }

  for (const [path, field] of Object.entries(preview ?? {})) {
    const box = field?.box;
    if (!box) continue;
    // A box with no page cannot be checked, and an unverifiable coordinate is
    // exactly what this rule exists to reject.
    const page = field.page ?? 1;
    const size = sizes.get(page);
    if (!size) {
      throw new HttpException(
        `${path} points at page ${page}, which the docdom does not describe`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // A one-pixel tolerance: a box derived by scaling back from a downscaled
    // bitmap lands on fractional coordinates and may round a hair past the
    // edge. Two pixels of slop is not a coordinate bug; a hundred is.
    const slop = 1;
    if (
      box.x < -slop ||
      box.y < -slop ||
      box.x + box.width > size.width + slop ||
      box.y + box.height > size.height + slop
    ) {
      throw new HttpException(
        `${path} has a box outside page ${page} (${size.width}x${size.height})`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}

function countSpans(docdom: DeviceReadingDto['docdom']): number {
  let n = 0;
  for (const block of docdom.blocks ?? []) {
    for (const line of block.lines ?? []) n += (line.spans ?? []).length;
  }
  return n;
}
