/**
 * @snap/db — SERVER ONLY.
 *
 * Never import this from the mobile app. It carries the `pg` driver, the full
 * schema and the tenant-isolation helpers; none of that belongs on a device.
 * The boundary is enforced by `test/boundaries.test.ts` at the repo root.
 */
export * as schema from './schema';
export * from './schema';
export {
  createDb,
  createPool,
  withTenant,
  // Membership-verified switching, and the error it throws. Added with the
  // workspace switcher (migration 0012): the tenant id now comes from the
  // client, so belonging to it is the authorisation decision.
  withTenantAs,
  asUser,
  listWorkspacesFor,
  NotAMemberError,
  claimJobs,
  completeJob,
  failJob,
  type Db,
  type Tx,
} from './client';
export * from './types';
export * as money from './money';
