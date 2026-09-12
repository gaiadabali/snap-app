/**
 * Which API methods change something.
 *
 * Kept in its own module, free of any native import, so it can be unit tested
 * in Node — `mock.ts` reaches AsyncStorage and cannot be loaded there.
 *
 * The convention exists because placing a `save()` call by hand in each
 * mutation is one chance per method to forget, and a forgotten one is a change
 * that silently does not survive a reload.
 */
export const MUTATION =
  /^(create|update|set|add|delete|remove|confirm|pay|record|count|contribute|invite|revoke|connect|disconnect|reject|await|sign|complete|convert)/;

/**
 * Methods that change session state and therefore MUST queue a write.
 *
 * Under-matching here loses a user's change on reload with nothing on screen
 * to suggest it. Over-matching only costs a debounced no-op write, which is
 * why the pattern errs generous.
 */
export const STATE_CHANGING = [
  'convertEstimate',
  'signIn',
  'signOut',
  'completeOnboarding',
  'updateDocument',
  'confirmDocument',
  'rejectDocument',
  'awaitExtraction',
  'setBudget',
  'createWorkspace',
  'inviteMember',
  'revokeInvitation',
  'updateMemberRole',
  'removeMember',
  'setVisibility',
  'updateLines',
  'payBill',
  'recordPayment',
  'addTrip',
  'deleteTrip',
  'countStock',
  'createGoal',
  'contributeToGoal',
  'deleteGoal',
  'updateBusinessSettings',
  'setCategoryActive',
  'createCategory',
  'connectAccounting',
  'disconnectAccounting',
  'createItem',
  'createParty',
] as const;

/**
 * Network side effects that change nothing locally.
 *
 * `createCapture` reserves an id and `uploadOriginal` PUTs bytes to storage;
 * neither touches session state, so whether they match the pattern is
 * immaterial. Listed so the set of methods stays exhaustive.
 */
export const SIDE_EFFECT_ONLY = ['createCapture', 'uploadOriginal'] as const;

/** Reads. None of these may match `MUTATION`, or every list would queue a write. */
export const READ_METHODS = [
  'getSession',
  'listDemoAccounts',
  'getOverview',
  'listDocuments',
  'getDocument',
  'getPersonal',
  'getAnalytics',
  'getSales',
  'listInvoices',
  'getInvoice',
  'listItems',
  'listParties',
  'listWorkspaces',
  'getPermissions',
  'listMembers',
  'listBills',
  'listPayments',
  'getMileage',
  'listStockMovements',
  'listRecurring',
  'listGoals',
  'getBusinessSettings',
  'listCategorySettings',
  'getPlanUsage',
  'listConnections',
  'getTaxPack',
] as const;
