import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { NotAMemberError } from '../repo.js';

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

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const body = error.getResponse();
      void reply.status(status).send(
        typeof body === 'string' ? { error: 'request_failed', message: body } : body,
      );
      return;
    }

    const asError = error instanceof Error ? error : new Error(String(error));
    this.logger.error(
      `500 ${request.method} ${request.url} — ${asError.message}`,
      asError.stack,
    );
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: 'internal_error',
      message: 'Something went wrong. It has been logged.',
    });
  }
}
