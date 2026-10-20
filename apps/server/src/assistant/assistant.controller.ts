import { Controller, Get, HttpCode, Logger, Post, Req, Res, type OnModuleInit } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import type { IncomingRequest } from './assistant.js';
import type { RawResponse } from './sse.js';
import { getAssistant } from './wiring.js';

/**
 * Snapper's routes (docs/ASSISTANT.md §3): a thin shell over `createAssistant`.
 *
 *   GET  /v1/assistant/status   { ok, name: 'Snapper' }
 *   POST /v1/assistant/chat     text/event-stream
 *
 * Both answer 404 unless X-Assistant-Proxy carries ASSISTANT_PROXY_SECRET:
 * only the web container's same-origin proxy (`apps/web/src/app/api/
 * assistant/**`) may call them. That check, the body-size limit and the
 * validation all live in `assistant.ts`, not in Nest — for three reasons:
 *
 *  - No constructor injection, no `@Body()` DTO. The server runs under tsx,
 *    which drops decorator metadata; anything depending on it is undefined in
 *    production while every vitest run passes (see `common/valid-body.
 *    decorator.ts`, `admin/guards/staff.guard.ts`). `@Req()`/`@Res()` are
 *    positional and need no metadata.
 *  - The stream is written to Fastify's raw response, after `reply.hijack()`,
 *    so Fastify never tries to send a reply of its own afterwards.
 *  - The global ValidationPipe never sees this body (it runs on `@Body()`
 *    parameters only), and the global JSON parser has already bounded it at
 *    1 MB; the 16 KB limit for this route is enforced in `assistant.ts`.
 *
 * Excluded from the public OpenAPI document: it is an internal, proxied
 * surface, not part of the app's API.
 */

type FastifyLikeRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip?: string;
};
type FastifyLikeReply = { hijack(): void; raw: RawResponse };

const toIncoming = (req: FastifyLikeRequest): IncomingRequest => ({
  headers: req.headers,
  body: req.body,
  socketIp: req.ip ?? 'unknown',
});

@ApiExcludeController()
@Controller('v1/assistant')
export class AssistantController implements OnModuleInit {
  /**
   * Load the knowledge pack and say what is configured at boot, so a missing
   * key, secret or pack is a log line at startup rather than a surprise on
   * the first question. Skipped under vitest, where suites boot AppModule for
   * unrelated reasons.
   */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) return;
    try {
      getAssistant();
    } catch (error) {
      new Logger('assistant').error(`assistant failed to initialise: ${String((error as Error)?.message ?? error)}`);
    }
  }

  @Get('status')
  async status(@Req() req: FastifyLikeRequest, @Res() reply: FastifyLikeReply): Promise<void> {
    const assistant = getAssistant(); // before hijack: a throw here still gets Nest's error response
    reply.hijack();
    await assistant.status(toIncoming(req), reply.raw);
  }

  @Post('chat')
  @HttpCode(200)
  async chat(@Req() req: FastifyLikeRequest, @Res() reply: FastifyLikeReply): Promise<void> {
    const assistant = getAssistant(); // before hijack: a throw here still gets Nest's error response
    reply.hijack();
    await assistant.chat(toIncoming(req), reply.raw);
  }
}
