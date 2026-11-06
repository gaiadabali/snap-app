import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';

import { config } from '../config.js';

const logger = new Logger('erased-log');

/**
 * 8.3.g R2: append the id of a person who deleted their own account to a file
 * on the host, OUTSIDE Postgres (`ERASED_LOG_DIR`, bind-mounted into the api,
 * pushed off-box by offsite.sh). Restoring a database backup from before the
 * deletion brings the account back, and nothing inside the database can say who
 * to erase again; this file can (docs/DEPLOY.md "Restoring from a backup",
 * deploy/re-erase-accounts.sh). One line, `<ISO time> <user id>`: never an address.
 *
 * Written AFTER the database has taken the request, and never allowed to fail
 * the request: someone's deletion must not hang on bookkeeping. A failure is
 * logged loudly instead (ponytail: no retry; a missed line is found by the
 * restore drill's count check, not silently).
 */
export async function recordSelfErased(userId: string): Promise<void> {
  const dir = config().ERASED_LOG_DIR;
  if (!dir) return;
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'accounts.log'), `${new Date().toISOString()} ${userId}\n`, { flag: 'a' });
  } catch (err) {
    logger.error(`could not record the erased account ${userId} in ${dir}: ${(err as Error).message}`);
  }
}
