/**
 * Starts the extraction worker. `pnpm --filter @snap/server worker`
 *
 * Separate from the API so it can be scaled, restarted and rate-limited on its
 * own — the API is bound by network, the worker by a model provider.
 */
import 'reflect-metadata';

import { useWorkerConnection } from '../src/db.js';
import { runForever } from '../src/worker.js';

// Before anything opens a connection: the worker connects as its own account,
// which is the only role permitted to read the queue across tenants.
useWorkerConnection();

await runForever();
