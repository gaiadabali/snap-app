import { describe, expect, it } from 'vitest';

import { loggableError } from './errors.filter.js';

describe('loggableError', () => {
  it('keeps a failed query’s SQL and the database’s reason, and drops its parameter values', () => {
    // The shape drizzle-orm gives a failed query (DrizzleQueryError).
    const cause = new Error('duplicate key value violates unique constraint "users_email_unique"');
    const error = new Error(
      'Failed query: select * from identity_yourtal_sign_in($1, $2, $3, $4, $5, $6)\n' +
        'params: q8mE3s0dW9xYbVvLr2H4tA,ana@example.com,true,Ana,false,true',
      { cause },
    );

    const logged = loggableError(error);
    const all = `${logged.message}\n${logged.stack ?? ''}`;
    expect(all).toContain('identity_yourtal_sign_in');
    expect(all).toContain('users_email_unique');
    expect(all).toContain('params: [redacted]');
    expect(all).not.toContain('q8mE3s0dW9xYbVvLr2H4tA');
    expect(all).not.toContain('ana@example.com');
  });

  it('leaves an ordinary error alone', () => {
    const error = new Error('something broke');
    expect(loggableError(error).message).toBe('something broke');
    expect(loggableError(error).stack).toBe(error.stack);
  });
});
