import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { NotAMemberError } from '../repo.js';
import { StatementPageCapError } from '../statements/pdf-statement-import.js';

/**
 * One place that turns an exception into a response.
 *
 * Two things it guarantees, both of which matter more than the formatting:
 *
 *  1. `NotAMemberError` — thrown by `withTenantAs` when the database says the
 *     caller does not belong to the tenant — becomes a 403, not a 500. It is
 *     an authorisation outcome, and a 500 would both mislead the client and
 *     bury a security-relevant event in the noise of ordinary faults.
 *
 *  2. An unexpected error returns a generic message. The stack, the SQL and
 *     the parameter values go to the log, never to the client: a database
 *     error that helpfully quotes the failing statement hands an attacker the
 *     schema one request at a time.
 */
/**
 * An error as it may be written to the log.
 *
 * drizzle wraps a failed query as "Failed query: <sql>\nparams: <values>",
 * in the message AND therefore the stack. The values are whatever the call
 * bound: for the identity functions that is a YourTal `sub`, an email address,
 * a name, a password hash. The SQL and the database's own reason are kept
 * (they are what makes the log useful); the values are not.
 */
export function loggableError(error: Error): { message: string; stack?: string } {
  const message = withoutParams(error.message);
  const cause = (error as { cause?: unknown }).cause;
  const reason = cause instanceof Error && cause.message ? ` (cause: ${withoutParams(cause.message)})` : '';
  const stack = error.stack ? error.stack.split(error.message).join(message) : undefined;
  return { message: `${message}${reason}`, stack };
}

function withoutParams(message: string): string {
  const at = message.indexOf('\nparams:');
  return at === -1 ? message : `${message.slice(0, at)}\nparams: [redacted]`;
}

@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse();
    const request = host.switchToHttp().getRequest();

    if (error instanceof NotAMemberError) {
      // Logged as a warning, not an error: it is an expected outcome of an
      // untrusted client sending a workspace id, and it should be visible in
      // an audit trail without paging anyone.
      this.logger.warn(
        `403 ${request.method} ${request.url} — user ${error.userId} is not a member of ${error.tenantId}`,
      );
      void reply.status(HttpStatus.FORBIDDEN).send({
        error: 'not_a_member',
        message: 'You do not have access to that workspace.',
      });
      return;
    }

    if (error instanceof StatementPageCapError) {
      // 413, the same answer an over-cap PDF already gets at intake
      // (`captures.controller.ts`'s post-demux check): the REQUEST is too
      // large, not the server broken. Thrown by the statement import path
      // if it is ever reached from a handler; today the worker calls it, so
      // this mapping is the contract for the day an HTTP path calls it too
      // — without it the typed error would surface as a misleading 500.
      void reply.status(HttpStatus.PAYLOAD_TOO_LARGE).send({
        error: 'statement_page_cap',
        message: error.message,
      });
      return;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      void reply.status(status).send(
        typeof body === 'string' ? { error: 'request_failed', message: body } : body,
      );
      return;
    }

    const asError = error instanceof Error ? error : new Error(String(error));
    const loggable = loggableError(asError);
    this.logger.error(`500 ${request.method} ${request.url} — ${loggable.message}`, loggable.stack);
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: 'internal_error',
      message: 'Something went wrong. It has been logged.',
    });
  }
}
