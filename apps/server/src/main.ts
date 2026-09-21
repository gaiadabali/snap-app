import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';
import { PREFLIGHT_ROLE_SQL, evaluatePreflight } from './preflight.js';
import { ErrorsFilter } from './common/errors.filter.js';
import { closeDb, getDb } from './db.js';
import { config, isGoogleSignInSimulatorEnabled } from './config.js';
import { simulationMode } from './integrations/simulation.js';
import { sql } from 'drizzle-orm';

import cors from '@fastify/cors';
import { IdempotencyInterceptor } from './common/idempotency.interceptor.js';

/**
 * The API process.
 *
 * Fastify rather than Express under Nest: schema-based serialisation, and the
 * adapter is swappable without touching a controller.
 */
/**
 * In production, refuse to start unless someone can actually sign in.
 *
 * The passwordless `/v1/auth/sign-in` endpoint is disabled in production
 * (see `auth.controller.ts`), which leaves the magic link and Google. Both can
 * be *present as routes* while being incapable of completing:
 *
 *   - the magic link needs a real mailer. As of docs/INTEGRATIONS.md Lane N
 *     one EXISTS (`auth/smtp-mailer.ts`), so this clause is no longer a
 *     hardcoded false — it asks `simulationMode('mailer')` whether this
 *     deployment actually has one;
 *   - Google needs `GOOGLE_CLIENT_ID`.
 *
 * If neither can work, the honest outcome is a server that refuses to boot and
 * says why. The alternative is one that starts, accepts magic-link requests,
 * answers 200 to every one of them, and delivers nothing — a locked building
 * whose doorbell is wired to nowhere. That failure is silent, arrives at
 * whoever is trying to log in rather than at whoever deployed it, and is
 * exactly the shape this codebase already refuses elsewhere: the Bedrock
 * provider throws rather than quietly falling back offshore.
 *
 * The simulated Google sign-in (`AuthController#googleSimulatorSignIn`,
 * gated by `isGoogleSignInSimulatorEnabled`) counts as a fourth way in,
 * deliberately: it exists precisely so the demo host — which IS a production
 * build, same image as everywhere else — does not hit this same refusal
 * before real Google credentials exist. It cannot satisfy this check by
 * accident: it requires its own two extra opt-ins (`DEMO_ENV=staging` and
 * `GOOGLE_SIGNIN_SIMULATOR=true`) on top of `NODE_ENV=production`, and it
 * turns itself back off the moment `GOOGLE_CLIENT_ID` is actually set — so a
 * plain production deployment with neither Google nor the simulator
 * configured still refuses to boot exactly as before.
 */
function assertProductionHasAWayIn(settings: ReturnType<typeof config>): void {
  if (settings.NODE_ENV !== 'production') return;

  const google = Boolean(settings.GOOGLE_CLIENT_ID);
  // WAS `const magicLink = false`, with a comment explaining that no real
  // Mailer implementation existed. One does now, and leaving the constant
  // would have been this project's signature bug in reverse: a control that
  // keeps refusing after the reason for it is gone. A production host with
  // working SMTP and no Google would have been unable to boot.
  //
  // `real` only. A SIMULATED mailer delivers to an in-process sink, which is
  // a way for a demo to sign in (and `preflight.ts` counts it as one there)
  // but is not a way for a customer to, and this function is about whether
  // the front door works.
  const mailerMode = simulationMode('mailer');
  const magicLink = mailerMode === 'real';
  const simulator = isGoogleSignInSimulatorEnabled() || mailerMode === 'simulated';
  if (google || magicLink || simulator) return;

  throw new Error(
    [
      'Refusing to start in production: no usable sign-in method.',
      '  - passwordless email sign-in is disabled in production, by design',
      '  - the magic link needs a real Mailer: set SMTP_URL (see docs/INTEGRATIONS.md Lane N). ' +
        'Without it the mailer is NoopMailer and delivers nothing',
      '  - Google needs GOOGLE_CLIENT_ID, which is not set',
      '  - the simulated Google sign-in needs DEMO_ENV=staging AND GOOGLE_SIGNIN_SIMULATOR=true, ' +
        'neither of which is set (see apps/server/src/config.ts#isGoogleSignInSimulatorEnabled)',
      'Configure Google, wire a real email provider, or enable the demo-host simulator, before deploying.',
    ].join('\n'),
  );
}

export async function bootstrap(): Promise<NestFastifyApplication> {
  // Read and validate configuration before anything else, so a missing
  // variable is a startup failure rather than a 500 on the request that
  // happens to need it.
  const settings = config();
  assertProductionHasAWayIn(settings);

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

  // The mailer is selected ONCE, here, and installed for the process —
  // docs/INTEGRATIONS.md Lane N. It happens after the preflight because a
  // refusal there (SMTP_ALLOW_INSECURE in production) should surface as a
  // boot failure alongside the others rather than on the first magic-link
  // request, and because the simulated transport starts a listener: doing
  // that on a host that is about to refuse to boot is pointless work.
  //
  // Every existing `getMailer()` call site is unchanged and simply starts
  // getting the real transport.
  const { installMailer, selectMailer } = await import('./auth/mailer.js');
  const selected = await selectMailer();
  installMailer(selected);
  logger.log(`mailer · ${selected.constructor.name}`);

  await app.listen({ port: settings.PORT, host: '0.0.0.0' });
  logger.log(`listening on ${settings.PORT} · docs at /v1/docs · env ${settings.NODE_ENV}`);
  return app;
}
