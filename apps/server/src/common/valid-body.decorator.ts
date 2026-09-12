import { Body, ValidationPipe, type Type } from '@nestjs/common';

/**
 * A request body, validated against an explicitly named DTO.
 *
 * Use this instead of `@Body()`. The difference is not stylistic — it is the
 * difference between validation running and validation silently not running.
 *
 * Nest's global `ValidationPipe` discovers which class to validate against by
 * reading the `design:paramtypes` metadata TypeScript emits for a decorated
 * parameter. This server runs under `tsx`, which compiles with esbuild, and
 * **esbuild does not implement `emitDecoratorMetadata`** — it honours
 * `experimentalDecorators` and drops the metadata. So the pipe receives no
 * metatype, concludes there is nothing to validate, and passes the body
 * straight through.
 *
 * The failure is invisible: every endpoint returns 201 and validation never
 * runs. An end-to-end test caught it by posting `not-an-email` to sign-in and
 * getting a user created. Nothing in the type system or the logs would have.
 *
 * Naming the type here removes the dependency on that metadata entirely, so
 * validation works under any compiler — and a reader can see which shape an
 * endpoint accepts without inferring it from a parameter annotation.
 *
 * (`tsx` is not casually replaceable: `@snap/tax-engine` uses extensionless
 * relative imports and needs a bundler-style resolver. See its README.)
 */
export function ValidBody<T>(dto: Type<T>): ParameterDecorator {
  return Body(
    new ValidationPipe({
      expectedType: dto,
      // Undeclared fields are stripped rather than passed on: an unexpected
      // key reaching a query builder is how mass assignment happens.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
}
