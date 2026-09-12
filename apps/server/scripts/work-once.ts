/** Drains the extraction queue once and exits. Used by tests and by hand. */
import 'reflect-metadata';

import { closeDb, useWorkerConnection } from '../src/db.js';
import { runOnce } from '../src/worker.js';

// Same account the long-running worker uses, so draining the queue by hand
// exercises the privileges the real thing has rather than whatever the shell
// happens to be connected as.
useWorkerConnection();

const done = await runOnce(Number(process.argv[2] ?? 5));
console.log(`processed ${done} job(s)`);
await closeDb();
