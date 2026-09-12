import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { PREFLIGHT_ROLE_SQL, evaluatePreflight } from './preflight.js';
import { ErrorsFilter } from './common/errors.filter.js';
import { closeDb, getDb } from './db.js';
import { config } from './config.js';
import { sql } from 'drizzle-orm';

import cors from '@fastify/cors';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';

/**
 * The API process.
 *
 * Fastify rather than Express under Nest: schema-based serialisation, and the
 * adapter is swappable without touching a controller.
 */
export async function bootstrap(): Promise<NestFastifyApplication> {
  // Read and validate configuration before anything else, so a missing
  // variable is a startup failure rather than a 500 on the request that
  // happens to need it.
  const settings = config();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // 30 MB: a phone photograph at full quality, which is deliberately not
      // downscaled before upload — the original is the legal record.
      bodyLimit: 32 * 1024 * 1024,
      // Fastify caps a single route parameter at 100 characters and answers
      // 414 past it. The upload token is a signed payload in the path and runs
      // to roughly 250 — as a presigned S3 URL would. Raised rather than
      // shortened, because the alternative is trimming a credential.
      //
      // Under `routerOptions` because reading it at the top level is
      // deprecated and removed in Fastify 6.
      routerOptions: { maxParamLength: 600 },
    }),
    { logger: ['error', 'warn', 'log'] },
  );

  /**
   * Originals arrive as raw bytes, not JSON.
   *
   * Registered as content-type parsers rather than as multipart: the client
   * PUTs the body straight to the URL it was handed, which is exactly what it
   * will do against presigned S3 later. Keeping the shape identical now means
   * the client does not change when the storage does.
   *
   * PDF is here alongside images because a supplier invoice arrives as an
   * emailed PDF far more often than as a photograph. Without this parser the
   * upload never reaches the controller at all — Fastify rejects the body with
   * a 415 before any of our code runs — which is a failure that looks like a
   * client bug and is not one.
   */
  const fastify = app.getHttpAdapter().getInstance();
  const rawBody = {
    parseAs: 'buffer' as const,
    bodyLimit: 32 * 1024 * 1024,
  };
  const passthrough = (
    _request: unknown,
    body: Buffer,
    done: (err: Error | null, body?: Buffer) => void,
  ) => {
    done(null, body);
  };
  fastify.addContentTypeParser(/^image\//, rawBody, passthrough);
  fastify.addContentTypeParser(/^application\/pdf$/, rawBody, passthrough);

  app.useGlobalPipes(
    new ValidationPipe({
      // Anything not declared on a DTO is dropped rather than passed through:
      // an unexpected field reaching a query builder is how mass-assignment
      // bugs happen.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  // Makes a RETRIED write happen once, for any client that sends an
  // `Idempotency-Key`. Inert without the header, so nothing that exists today
  // changes behaviour — see the interceptor's own header for why that is the
  // right default rather than an opt-in per endpoint.
  app.useGlobalInterceptors(new IdempotencyInterceptor());

  app.useGlobalFilters(new ErrorsFilter());

  /**
   * The OpenAPI document.
   *
   * Generated from the same decorators and DTOs that validate requests, so it
   * cannot drift from the implementation — which is the failure mode of every
   * hand-maintained spec. `docs/PLAN.md` §8 lists this as outstanding; this is
   * it.
   */
  const spec = new DocumentBuilder()
    .setTitle('Snap Apps API')
    .setDescription(
      'Capture, extraction and review. Every tenant-scoped read runs inside a membership-verified transaction; see packages/db withTenantAs.',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'session')
    .build();
  SwaggerModule.setup('v1/docs', app, SwaggerModule.createDocument(app, spec), {
    jsonDocumentUrl: 'v1/openapi.json',
  });

  const logger = new Logger('bootstrap');

  // The app runs on a different origin from the API — Expo's dev server in
  // development, and a native app (which sends `Origin: null`) or a hosted web
  // build in production. So CORS is required, and it is a real allow-list
  // rather than `*`: these responses carry someone's financial records, and a
  // wildcard invites any page the user happens to have open to read them.
  //
  // `credentials` stays OFF deliberately. Authentication is a bearer token in
  // a header, not a cookie, so no browser is ever asked to attach ambient
  // credentials to a cross-origin request — which is what removes CSRF from
  // this design rather than mitigating it.
  await app.register(cors, {
    origin: settings.CORS_ORIGINS.length > 0 ? settings.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // Every header the client actually sends. A header missing from this list
    // is not a soft failure: the browser refuses the request at preflight and
    // the app sees a network error, indistinguishable from being offline —
    // which is precisely how the offline outbox came to queue a write and
    // then never be able to send it.
    // `X-Impersonation-Token` is here for the same reason the others are: a
    // header missing from this list is refused by the browser at PREFLIGHT,
    // and the client sees a network error indistinguishable from being
    // offline. That is precisely how the offline outbox once queued a write it
    // could never send. The web console talks to this API server-side, so it
    // is not subject to CORS today — this costs nothing and removes a trap for
    // whoever first calls it from a browser.
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Workspace-Id',
      'Idempotency-Key',
      'X-Impersonation-Token',
    ],
    credentials: false,
    maxAge: 600,
  });

  // Shut down cleanly: finish in-flight requests, then release the pool. A
  // process killed with connections open leaves Postgres holding them until
  // the TCP timeout.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} — closing`);
      void app
        .close()
        .then(closeDb)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }

  /**
   * Production preflight.
   *
   * Deliberately AFTER the app is wired and BEFORE it accepts a connection:
   * the database probe needs the pool, and a server that fails this must never
   * have served a request. Configuration that is individually valid can still
   * be collectively unsafe — see `preflight.ts` for what each check is for and
   * which of them correspond to bugs this project has already shipped.
   */
  let probe = { databaseRole: 'unknown', bypassesRls: false };
  try {
    const who = await getDb().execute<{ role: string; bypasses: boolean }>(
      sql.raw(PREFLIGHT_ROLE_SQL),
    );
    probe = {
      databaseRole: who.rows[0]?.role ?? 'unknown',
      bypassesRls: who.rows[0]?.bypasses === true,
    };
  } catch (error) {
    // A database that cannot be reached is a startup failure in its own right.
    logger.error(`preflight could not reach the database: ${String(error)}`);
    throw error;
  }

  const preflight = evaluatePreflight(settings, probe);
  for (const warning of preflight.warnings) logger.warn(`preflight: ${warning}`);
  if (!preflight.ok) {
    for (const failure of preflight.failures) logger.error(`preflight: ${failure}`);
    throw new Error(
      `Refusing to start: ${preflight.failures.length} production preflight check(s) failed. ` +
        'See the errors above.',
    );
  }
  logger.log(`preflight ok · database role ${probe.databaseRole} · rls ${probe.bypassesRls ? 'BYPASSED' : 'enforced'}`);

  await app.listen({ port: settings.PORT, host: '0.0.0.0' });
  logger.log(`listening on ${settings.PORT} · docs at /v1/docs · env ${settings.NODE_ENV}`);
  return app;
}
